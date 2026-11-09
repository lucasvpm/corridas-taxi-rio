import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as amqplib from 'amqplib';
import { AppModule } from '../src/app.module';
import { CorridaCacheService } from '../src/cache/corrida-cache.service';
import { CorridaEventHandler } from '../src/consumer/corrida-event.handler';
import { HistoricoService } from '../src/historico/historico.service';
import { EventEnvelope } from '../src/messaging/envelope';

/** Monta um envelope válido de evento de corrida. */
function evento(
  corridaId: string,
  version: number,
  status: string,
): EventEnvelope {
  return {
    event_id: randomUUID(),
    type: version === 1 ? 'corrida.criada' : 'corrida.status_alterado',
    occurred_at: new Date().toISOString(),
    corrida_id: corridaId,
    version,
    data: {
      id: corridaId,
      passageiro_id: 'p-worker-test',
      motorista_id: version > 1 ? 'm-1' : null,
      origem: 'Gávea',
      destino: 'Urca',
      status,
      version,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

/** Espera uma condição assíncrona ficar verdadeira. */
async function eventually(
  check: () => Promise<boolean>,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condição não satisfeita a tempo');
}

describe('worker (e2e, infra real)', () => {
  let app: INestApplication;
  let handler: CorridaEventHandler;
  let cache: CorridaCacheService;
  let historico: HistoricoService;
  let conn: amqplib.ChannelModel;
  let ch: amqplib.Channel;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
    handler = app.get(CorridaEventHandler);
    cache = app.get(CorridaCacheService);
    historico = app.get(HistoricoService);

    conn = await amqplib.connect(
      process.env.AMQP_URL ??
        'amqp://corridas:corridas_dev_only@localhost:5672',
    );
    ch = await conn.createChannel();
    // Espera o consumer declarar a fila de teste.
    await eventually(async () => {
      try {
        const probe = await conn.createChannel();
        await probe.checkQueue(process.env.WORKER_QUEUE!);
        await probe.close();
        return true;
      } catch {
        return false;
      }
    });
  });

  afterAll(async () => {
    // Limpeza tolerante: se o beforeAll falhou, não mascara o erro original.
    await app?.close();
    if (ch) {
      for (const q of [process.env.WORKER_QUEUE!, process.env.WORKER_DLQ!]) {
        await ch.deleteQueue(q).catch(() => undefined);
      }
      await ch.deleteExchange(process.env.WORKER_DLX!).catch(() => undefined);
      await ch.close();
    }
    await conn?.close();
  });

  describe('handler (at-least-once)', () => {
    it('não duplica histórico quando o mesmo evento é entregue duas vezes', async () => {
      const e = evento(randomUUID(), 1, 'SOLICITADA');

      const primeira = await handler.handle(e, 'corr-1');
      const segunda = await handler.handle(e, 'corr-1');

      expect(primeira).toBe('processed');
      expect(segunda).toBe('duplicate');
      const docs = await historico.listar(e.corrida_id);
      expect(docs).toHaveLength(1);
      expect(docs[0]._id).toBe(e.event_id);
      expect(docs[0].correlation_id).toBe('corr-1');
      expect(await cache.get(e.corrida_id)).toMatchObject({
        status: 'SOLICITADA',
        version: 1,
      });
    });

    it('não sobrescreve o cache com evento mais antigo que chega fora de ordem', async () => {
      const id = randomUUID();
      await handler.handle(evento(id, 3, 'EM_ANDAMENTO'), null);
      await handler.handle(evento(id, 2, 'ACEITA'), null);

      expect(await cache.get(id)).toMatchObject({
        status: 'EM_ANDAMENTO',
        version: 3,
      });
      // O histórico guarda os dois: é auditoria, não estado.
      expect(await historico.listar(id)).toHaveLength(2);
    });

    it('não grava previous_status no snapshot do cache', async () => {
      const id = randomUUID();
      const e = evento(id, 2, 'ACEITA');
      e.data.previous_status = 'SOLICITADA';
      await handler.handle(e, null);
      expect(await cache.get(id)).not.toHaveProperty('previous_status');
    });
  });

  describe('consumo pelo broker', () => {
    it('processa evento publicado na exchange e atualiza Redis e Mongo', async () => {
      const e = evento(randomUUID(), 1, 'SOLICITADA');
      ch.publish('corridas', 'corrida.criada', Buffer.from(JSON.stringify(e)), {
        persistent: true,
        headers: { correlation_id: 'corr-broker' },
      });

      await eventually(
        async () => (await historico.listar(e.corrida_id)).length === 1,
      );
      expect(await cache.get(e.corrida_id)).toMatchObject({ version: 1 });
      const [doc] = await historico.listar(e.corrida_id);
      expect(doc.correlation_id).toBe('corr-broker');
    });

    it('tolera a mesma mensagem publicada duas vezes (reentrega)', async () => {
      const e = evento(randomUUID(), 1, 'SOLICITADA');
      const body = Buffer.from(JSON.stringify(e));
      ch.publish('corridas', 'corrida.criada', body, { persistent: true });
      ch.publish('corridas', 'corrida.criada', body, { persistent: true });

      await eventually(
        async () => (await historico.listar(e.corrida_id)).length === 1,
      );
      await new Promise((r) => setTimeout(r, 500));
      expect(await historico.listar(e.corrida_id)).toHaveLength(1);
    });

    it('envia mensagem malformada para a DLQ sem travar a fila', async () => {
      const marker = randomUUID();
      ch.publish(
        'corridas',
        'corrida.criada',
        Buffer.from(`{"quebrado": "${marker}"`),
        { persistent: true },
      );

      let deadLettered: amqplib.GetMessage | false = false;
      await eventually(async () => {
        deadLettered = await ch.get(process.env.WORKER_DLQ!, { noAck: true });
        return deadLettered !== false;
      });
      expect(
        (deadLettered as unknown as amqplib.GetMessage).content.toString(),
      ).toContain(marker);

      // A fila continua andando: um evento válido depois do inválido é processado.
      const e = evento(randomUUID(), 1, 'SOLICITADA');
      ch.publish('corridas', 'corrida.criada', Buffer.from(JSON.stringify(e)));
      await eventually(
        async () => (await historico.listar(e.corrida_id)).length === 1,
      );
    });
  });
});
