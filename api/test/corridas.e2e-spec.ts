import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  captureEvents,
  createApp,
  EventCapture,
  Identity,
  newMotorista,
  newPassageiro,
  otherPrivateKey,
  signToken,
} from './helpers';

describe('corridas (e2e, infra real)', () => {
  let app: INestApplication<App>;
  let http: App;
  let events: EventCapture;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
    events = await captureEvents();
  });

  afterAll(async () => {
    await events.close();
    await app.close();
  });

  /** Cria uma corrida via API e devolve o corpo da resposta. */
  async function criarCorrida(
    passageiro: Identity,
    body = { origem: 'Copacabana', destino: 'Centro' },
    key = randomUUID(),
  ) {
    const res = await request(http)
      .post('/corridas')
      .set('Authorization', `Bearer ${passageiro.token}`)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    return res.body as Record<string, any>;
  }

  /** Muda o status de uma corrida como motorista. */
  function patchStatus(motorista: Identity, id: string, status: string) {
    return request(http)
      .patch(`/corridas/${id}/status`)
      .set('Authorization', `Bearer ${motorista.token}`)
      .send({ status });
  }

  /** Conta linhas de corrida de um passageiro direto no MySQL. */
  async function contarCorridas(passageiroId: string): Promise<number> {
    const rows: Array<{ c: string | number }> = await app
      .get(DataSource)
      .query('SELECT COUNT(*) AS c FROM corridas WHERE passageiro_id = ?', [
        passageiroId,
      ]);
    return Number(rows[0].c);
  }

  describe('autenticação (401)', () => {
    it('retorna 401 sem token', async () => {
      await request(http).get('/corridas').expect(401);
    });

    it('retorna 401 com token assinado por outra chave', async () => {
      const token = signToken('p-1', 'passageiro', {
        privateKey: otherPrivateKey(),
      });
      await request(http)
        .get('/corridas')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('retorna 401 com token expirado', async () => {
      const token = signToken('p-1', 'passageiro', { expiresInSeconds: -60 });
      await request(http)
        .get('/corridas')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('retorna 401 com role desconhecido no token', async () => {
      const token = signToken('admin-1', 'admin');
      await request(http)
        .get('/corridas')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('não exige token em /health/live', async () => {
      await request(http).get('/health/live').expect(200);
    });
  });

  describe('autorização por papel (403)', () => {
    it('retorna 403 quando motorista tenta criar corrida', async () => {
      await request(http)
        .post('/corridas')
        .set('Authorization', `Bearer ${newMotorista().token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ origem: 'A', destino: 'B' })
        .expect(403);
    });

    it('retorna 403 quando passageiro tenta alterar status', async () => {
      const passageiro = newPassageiro();
      const corrida = await criarCorrida(passageiro);
      await patchStatus(passageiro, corrida.id, 'ACEITA').expect(403);
    });

    it('retorna 403 quando motorista tenta ler corrida', async () => {
      const corrida = await criarCorrida(newPassageiro());
      await request(http)
        .get(`/corridas/${corrida.id}`)
        .set('Authorization', `Bearer ${newMotorista().token}`)
        .expect(403);
    });
  });

  describe('criação e idempotência', () => {
    it('cria corrida SOLICITADA versão 1 sem expor colunas internas', async () => {
      const passageiro = newPassageiro();
      const corrida = await criarCorrida(passageiro);
      expect(corrida).toMatchObject({
        passageiro_id: passageiro.sub,
        motorista_id: null,
        origem: 'Copacabana',
        destino: 'Centro',
        status: 'SOLICITADA',
        version: 1,
      });
      expect(corrida.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(corrida).not.toHaveProperty('idempotency_key');
    });

    it('não duplica a corrida quando o mesmo POST é reenviado com a mesma Idempotency-Key', async () => {
      const passageiro = newPassageiro();
      const key = randomUUID();
      const primeira = await criarCorrida(passageiro, undefined, key);

      const repetida = await request(http)
        .post('/corridas')
        .set('Authorization', `Bearer ${passageiro.token}`)
        .set('Idempotency-Key', key)
        .send({ origem: 'Copacabana', destino: 'Centro' })
        .expect(200);

      expect(repetida.headers['idempotent-replayed']).toBe('true');
      expect(repetida.body.id).toBe(primeira.id);
      expect(await contarCorridas(passageiro.sub)).toBe(1);
    });

    it('cria uma única corrida quando requisições iguais chegam ao mesmo tempo', async () => {
      const passageiro = newPassageiro();
      const key = randomUUID();
      const respostas = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(http)
            .post('/corridas')
            .set('Authorization', `Bearer ${passageiro.token}`)
            .set('Idempotency-Key', key)
            .send({ origem: 'Lapa', destino: 'Tijuca' }),
        ),
      );

      const ids = new Set(respostas.map((r) => r.body.id as string));
      expect(respostas.every((r) => [200, 201].includes(r.status))).toBe(true);
      expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
      expect(ids.size).toBe(1);
      expect(await contarCorridas(passageiro.sub)).toBe(1);
    });

    it('permite a mesma Idempotency-Key para passageiros diferentes', async () => {
      const key = randomUUID();
      const a = await criarCorrida(newPassageiro(), undefined, key);
      const b = await criarCorrida(newPassageiro(), undefined, key);
      expect(a.id).not.toBe(b.id);
    });

    it('retorna 422 quando a Idempotency-Key é reutilizada com outro payload', async () => {
      const passageiro = newPassageiro();
      const key = randomUUID();
      await criarCorrida(passageiro, undefined, key);
      await request(http)
        .post('/corridas')
        .set('Authorization', `Bearer ${passageiro.token}`)
        .set('Idempotency-Key', key)
        .send({ origem: 'Outro lugar', destino: 'Centro' })
        .expect(422);
      expect(await contarCorridas(passageiro.sub)).toBe(1);
    });

    it('retorna 400 sem o header Idempotency-Key', async () => {
      await request(http)
        .post('/corridas')
        .set('Authorization', `Bearer ${newPassageiro().token}`)
        .send({ origem: 'A', destino: 'B' })
        .expect(400);
    });

    it('retorna 400 quando o body tenta definir campos que vêm do token', async () => {
      await request(http)
        .post('/corridas')
        .set('Authorization', `Bearer ${newPassageiro().token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ origem: 'A', destino: 'B', passageiro_id: 'outra-pessoa' })
        .expect(400);
    });

    it('retorna 400 para origem com marcação HTML', async () => {
      await request(http)
        .post('/corridas')
        .set('Authorization', `Bearer ${newPassageiro().token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ origem: '<script>alert(1)</script>', destino: 'B' })
        .expect(400);
    });
  });

  describe('leitura (cache-aside)', () => {
    it('lê a própria corrida: MISS na primeira leitura e HIT na segunda', async () => {
      const passageiro = newPassageiro();
      const corrida = await criarCorrida(passageiro);

      const r1 = await request(http)
        .get(`/corridas/${corrida.id}`)
        .set('Authorization', `Bearer ${passageiro.token}`)
        .expect(200);
      const r2 = await request(http)
        .get(`/corridas/${corrida.id}`)
        .set('Authorization', `Bearer ${passageiro.token}`)
        .expect(200);

      // O worker pode já ter populado o cache via evento; nesse caso as duas são HIT.
      expect(['MISS', 'HIT']).toContain(r1.headers['x-cache']);
      expect(r2.headers['x-cache']).toBe('HIT');
      expect(r2.body).toEqual(r1.body);
    });

    it('retorna 404 (e não 403) ao ler corrida de outro passageiro', async () => {
      const corrida = await criarCorrida(newPassageiro());
      // Lê duas vezes para cobrir os dois caminhos (MySQL e cache).
      for (let i = 0; i < 2; i++) {
        await request(http)
          .get(`/corridas/${corrida.id}`)
          .set('Authorization', `Bearer ${newPassageiro().token}`)
          .expect(404);
      }
    });

    it('lista apenas as corridas do próprio passageiro', async () => {
      const passageiro = newPassageiro();
      const minha = await criarCorrida(passageiro);
      await criarCorrida(newPassageiro());
      const res = await request(http)
        .get('/corridas')
        .set('Authorization', `Bearer ${passageiro.token}`)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(minha.id);
    });

    it('retorna 400 para id que não é UUID', async () => {
      await request(http)
        .get('/corridas/123')
        .set('Authorization', `Bearer ${newPassageiro().token}`)
        .expect(400);
    });
  });

  describe('mudança de status', () => {
    it('percorre o fluxo feliz SOLICITADA → ACEITA → EM_ANDAMENTO → FINALIZADA', async () => {
      const passageiro = newPassageiro();
      const motorista = newMotorista();
      const corrida = await criarCorrida(passageiro);

      const aceita = await patchStatus(motorista, corrida.id, 'ACEITA').expect(
        200,
      );
      expect(aceita.body).toMatchObject({
        status: 'ACEITA',
        motorista_id: motorista.sub,
        version: 2,
      });
      await patchStatus(motorista, corrida.id, 'EM_ANDAMENTO').expect(200);
      const fim = await patchStatus(motorista, corrida.id, 'FINALIZADA').expect(
        200,
      );
      expect(fim.body).toMatchObject({ status: 'FINALIZADA', version: 4 });
    });

    it('retorna 409 para transição fora da máquina de estados', async () => {
      const corrida = await criarCorrida(newPassageiro());
      await patchStatus(newMotorista(), corrida.id, 'FINALIZADA').expect(409);
    });

    it('retorna 409 quando um segundo motorista tenta aceitar corrida já aceita', async () => {
      const corrida = await criarCorrida(newPassageiro());
      await patchStatus(newMotorista(), corrida.id, 'ACEITA').expect(200);
      await patchStatus(newMotorista(), corrida.id, 'ACEITA').expect(409);
    });

    it('só um motorista vence quando dois aceitam ao mesmo tempo', async () => {
      const corrida = await criarCorrida(newPassageiro());
      const respostas = await Promise.all([
        patchStatus(newMotorista(), corrida.id, 'ACEITA'),
        patchStatus(newMotorista(), corrida.id, 'ACEITA'),
      ]);
      const status = respostas.map((r) => r.status).sort();
      expect(status).toEqual([200, 409]);
    });

    it('retorna 403 quando outro motorista tenta iniciar corrida aceita por alguém', async () => {
      const corrida = await criarCorrida(newPassageiro());
      await patchStatus(newMotorista(), corrida.id, 'ACEITA').expect(200);
      await patchStatus(newMotorista(), corrida.id, 'EM_ANDAMENTO').expect(403);
    });

    it('retorna 403 (e não 409) quando outro motorista pede transição inválida em corrida alheia', async () => {
      const corrida = await criarCorrida(newPassageiro());
      await patchStatus(newMotorista(), corrida.id, 'ACEITA').expect(200);
      const res = await patchStatus(newMotorista(), corrida.id, 'FINALIZADA');
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('ACEITA');
    });

    it('GET reflete o novo status logo após o PATCH, mesmo com o cache já populado', async () => {
      const passageiro = newPassageiro();
      const motorista = newMotorista();
      const corrida = await criarCorrida(passageiro);
      await request(http)
        .get(`/corridas/${corrida.id}`)
        .set('Authorization', `Bearer ${passageiro.token}`)
        .expect(200);

      await patchStatus(motorista, corrida.id, 'ACEITA').expect(200);

      const res = await request(http)
        .get(`/corridas/${corrida.id}`)
        .set('Authorization', `Bearer ${passageiro.token}`)
        .expect(200);
      expect(res.body).toMatchObject({ status: 'ACEITA', version: 2 });
    });

    it('retorna 400 para status desconhecido', async () => {
      const corrida = await criarCorrida(newPassageiro());
      await patchStatus(newMotorista(), corrida.id, 'VOANDO').expect(400);
    });

    it('retorna 404 para corrida inexistente', async () => {
      await patchStatus(newMotorista(), randomUUID(), 'ACEITA').expect(404);
    });
  });

  describe('eventos no RabbitMQ', () => {
    it('publica corrida.criada com envelope e o correlation_id da requisição', async () => {
      const passageiro = newPassageiro();
      const correlationId = `teste-${randomUUID()}`;
      const res = await request(http)
        .post('/corridas')
        .set('Authorization', `Bearer ${passageiro.token}`)
        .set('Idempotency-Key', randomUUID())
        .set('X-Correlation-Id', correlationId)
        .send({ origem: 'Botafogo', destino: 'Leblon' })
        .expect(201);

      expect(res.headers['x-correlation-id']).toBe(correlationId);
      const msg = await events.waitFor(
        (m) => m.body.corrida_id === res.body.id,
      );
      expect(msg.routingKey).toBe('corrida.criada');
      expect(msg.headers.correlation_id).toBe(correlationId);
      expect(msg.body).toMatchObject({
        type: 'corrida.criada',
        corrida_id: res.body.id,
        version: 1,
        data: { status: 'SOLICITADA', passageiro_id: passageiro.sub },
      });
      expect(msg.body.event_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('publica corrida.status_alterado com o status anterior', async () => {
      const corrida = await criarCorrida(newPassageiro());
      await patchStatus(newMotorista(), corrida.id, 'ACEITA').expect(200);
      const msg = await events.waitFor(
        (m) =>
          m.body.corrida_id === corrida.id &&
          m.routingKey === 'corrida.status_alterado',
      );
      expect(msg.body).toMatchObject({
        version: 2,
        data: { status: 'ACEITA', previous_status: 'SOLICITADA' },
      });
    });

    it('não publica novo evento quando o POST é um replay idempotente', async () => {
      const passageiro = newPassageiro();
      const key = randomUUID();
      const corrida = await criarCorrida(passageiro, undefined, key);
      await request(http)
        .post('/corridas')
        .set('Authorization', `Bearer ${passageiro.token}`)
        .set('Idempotency-Key', key)
        .send({ origem: 'Copacabana', destino: 'Centro' })
        .expect(200);
      await events.waitFor((m) => m.body.corrida_id === corrida.id);
      await new Promise((r) => setTimeout(r, 500));
      const criadas = events
        .all()
        .filter((m) => m.body.corrida_id === corrida.id);
      expect(criadas).toHaveLength(1);
    });
  });

  describe('métricas', () => {
    it('expõe /metrics sem token e conta respostas 401 por rota', async () => {
      await request(http).get('/corridas').expect(401);
      const res = await request(http).get('/metrics').expect(200);
      expect(res.text).toMatch(
        /http_requests_total\{method="GET",route="\/corridas",status="401"\} \d+/,
      );
      expect(res.text).toContain('http_request_duration_seconds_bucket');
    });
  });
  describe('lista do motorista', () => {
    type ItemLista = Record<string, any>;

    /** Busca o painel do motorista (corridas em curso e disponíveis). */
    async function painel(motorista: Identity) {
      const res = await request(http)
        .get('/motorista/corridas')
        .set('Authorization', `Bearer ${motorista.token}`)
        .expect(200);
      return res.body as { em_curso: ItemLista[]; disponiveis: ItemLista[] };
    }

    /** Ids de uma lista do painel. */
    const ids = (lista: ItemLista[]) => lista.map((c) => c.id as string);

    it('mostra a corrida nova nas disponíveis com o próximo status e sem dados do passageiro', async () => {
      const corrida = await criarCorrida(newPassageiro());
      const { disponiveis } = await painel(newMotorista());
      const item = disponiveis.find((c) => c.id === corrida.id);
      expect(item).toMatchObject({
        origem: 'Copacabana',
        destino: 'Centro',
        status: 'SOLICITADA',
        version: 1,
        proximo_status: 'ACEITA',
      });
      expect(item).not.toHaveProperty('passageiro_id');
      expect(item).not.toHaveProperty('idempotency_key');
    });

    it('leva a corrida aceita para "em curso" de quem aceitou e a tira das disponíveis de todos', async () => {
      const corrida = await criarCorrida(newPassageiro());
      const motorista = newMotorista();
      const outro = newMotorista();
      await patchStatus(motorista, corrida.id, 'ACEITA').expect(200);

      const meu = await painel(motorista);
      expect(meu.em_curso.find((c) => c.id === corrida.id)).toMatchObject({
        status: 'ACEITA',
        motorista_id: motorista.sub,
        proximo_status: 'EM_ANDAMENTO',
      });
      expect(ids(meu.disponiveis)).not.toContain(corrida.id);

      const deOutro = await painel(outro);
      expect(ids(deOutro.em_curso)).not.toContain(corrida.id);
      expect(ids(deOutro.disponiveis)).not.toContain(corrida.id);
    });

    it('tira a corrida da lista quando ela é finalizada', async () => {
      const corrida = await criarCorrida(newPassageiro());
      const motorista = newMotorista();
      for (const status of ['ACEITA', 'EM_ANDAMENTO', 'FINALIZADA']) {
        await patchStatus(motorista, corrida.id, status).expect(200);
      }
      const { em_curso, disponiveis } = await painel(motorista);
      expect(ids(em_curso)).not.toContain(corrida.id);
      expect(ids(disponiveis)).not.toContain(corrida.id);
    });

    it('retorna 403 quando passageiro tenta ver a lista do motorista', async () => {
      await request(http)
        .get('/motorista/corridas')
        .set('Authorization', `Bearer ${newPassageiro().token}`)
        .expect(403);
    });

    it('não devolve dados do passageiro na resposta do PATCH', async () => {
      const corrida = await criarCorrida(newPassageiro());
      const res = await patchStatus(
        newMotorista(),
        corrida.id,
        'ACEITA',
      ).expect(200);
      expect(res.body).toMatchObject({
        status: 'ACEITA',
        proximo_status: 'EM_ANDAMENTO',
      });
      expect(res.body).not.toHaveProperty('passageiro_id');
    });
  });
});
