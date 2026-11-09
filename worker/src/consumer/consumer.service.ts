import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import * as amqp from 'amqp-connection-manager';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';
import {
  EventEnvelope,
  InvalidMessageError,
  parseEnvelope,
} from '../messaging/envelope';
import { assertTopology, TopologyNames } from '../messaging/topology';
import { runWithCorrelation } from '../observability/correlation';
import {
  eventLagSeconds,
  messagesTotal,
  processingSeconds,
  setQueueDepthProbe,
} from '../observability/metrics';
import { CorridaEventHandler } from './corrida-event.handler';

const tracer = trace.getTracer('corridas-worker');
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

/**
 * Backoff exponencial pelo número de entregas anteriores (header x-delivery-count da fila quorum):
 * 2s, 4s, 8s, 16s, 30s → ~1 min de tolerância a uma dependência fora antes de ir para a DLQ.
 */
export function retryDelayMs(deliveryCount: number): number {
  return Math.min(
    RETRY_BASE_MS * 2 ** Math.max(0, deliveryCount),
    RETRY_MAX_MS,
  );
}

/** Converte um valor de header AMQP (string ou Buffer) em string. */
function headerAsString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return null;
}

/**
 * Consumer AMQP: ack manual, prefetch limitado e reconexão automática.
 * Decide o destino de cada mensagem:
 * - sucesso (inclusive duplicada)          → ack
 * - malformada (não adianta tentar de novo) → nack sem requeue → DLQ
 * - erro transitório (Redis/Mongo fora)     → backoff exponencial + nack com requeue;
 *                                             após 5 entregas a fila quorum manda para a DLQ
 */
@Injectable()
export class ConsumerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ConsumerService.name);
  private connection!: AmqpConnectionManager;
  private channel!: ChannelWrapper;
  private readonly names: TopologyNames;

  /** Lê nomes de fila da configuração. */
  constructor(
    private readonly config: ConfigService,
    private readonly handler: CorridaEventHandler,
  ) {
    this.names = {
      queue: config.getOrThrow<string>('WORKER_QUEUE'),
      dlx: config.getOrThrow<string>('WORKER_DLX'),
      dlq: config.getOrThrow<string>('WORKER_DLQ'),
    };
  }

  /** Conecta, declara a topologia e começa a consumir (sem travar o boot se o broker estiver fora). */
  onModuleInit(): void {
    this.connection = amqp.connect(
      [this.config.getOrThrow<string>('AMQP_URL')],
      { heartbeatIntervalInSeconds: 10, reconnectTimeInSeconds: 2 },
    );
    this.connection.on('connect', () =>
      this.logger.log('Conectado ao RabbitMQ'),
    );
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn({ err: err?.message }, 'Desconectado do RabbitMQ'),
    );
    this.channel = this.connection.createChannel({
      setup: (ch: Channel) => assertTopology(ch, this.names),
    });
    this.channel
      .consume(this.names.queue, (msg) => void this.onMessage(msg), {
        prefetch: Number(this.config.getOrThrow('PREFETCH')),
        noAck: false,
      })
      .then(() =>
        this.logger.log({ queue: this.names.queue }, 'Consumindo fila'),
      )
      .catch((err: Error) =>
        this.logger.error({ err: err.message }, 'Falha ao iniciar consumo'),
      );

    setQueueDepthProbe(async () => {
      const [main, dlq] = await Promise.all([
        this.channel.checkQueue(this.names.queue),
        this.channel.checkQueue(this.names.dlq),
      ]);
      return [
        { queue: this.names.queue, count: main.messageCount },
        { queue: this.names.dlq, count: dlq.messageCount },
      ];
    });
  }

  /** Diz se há conexão ativa com o broker (readiness). */
  isConnected(): boolean {
    return this.connection?.isConnected() ?? false;
  }

  /** Trata uma mensagem recebida. `null` = o broker cancelou o consumer (fila removida/failover). */
  private async onMessage(msg: ConsumeMessage | null): Promise<void> {
    if (!msg) {
      this.logger.warn('Consumer cancelado pelo broker; aguardando reconexão');
      return;
    }
    const type = msg.fields.routingKey;
    let envelope: EventEnvelope;
    try {
      envelope = parseEnvelope(msg.content);
    } catch (err) {
      messagesTotal.inc({ type, result: 'invalid' });
      this.logger.warn(
        {
          err: (err as Error).message,
          message_id: msg.properties.messageId as string | undefined,
        },
        'Mensagem inválida enviada para a DLQ',
      );
      this.channel.nack(msg, false, false);
      return;
    }

    const headers = (msg.properties.headers ?? {}) as Record<string, unknown>;
    const correlationId = headerAsString(headers.correlation_id);
    const carrier: Record<string, string> = {};
    for (const key of ['traceparent', 'tracestate']) {
      const value = headerAsString(headers[key]);
      if (value) carrier[key] = value;
    }
    // Continua o trace iniciado na API (o traceparent veio no header da mensagem).
    const parentCtx = propagation.extract(ROOT_CONTEXT, carrier);

    await runWithCorrelation(correlationId ?? envelope.event_id, () =>
      context.with(parentCtx, () =>
        tracer.startActiveSpan(
          `${this.names.queue} process`,
          {
            kind: SpanKind.CONSUMER,
            attributes: {
              'messaging.system': 'rabbitmq',
              'messaging.destination.name': this.names.queue,
              'messaging.message.id': envelope.event_id,
              'messaging.rabbitmq.destination.routing_key': type,
              'corrida.id': envelope.corrida_id,
            },
          },
          async (span) => {
            const stopTimer = processingSeconds.startTimer({ type });
            try {
              const result = await this.handler.handle(envelope, correlationId);
              this.channel.ack(msg);
              messagesTotal.inc({ type, result });
              eventLagSeconds.observe(
                { type },
                (Date.now() - Date.parse(envelope.occurred_at)) / 1000,
              );
              this.logger.log(
                {
                  event_id: envelope.event_id,
                  type,
                  corrida_id: envelope.corrida_id,
                  version: envelope.version,
                  status: envelope.data.status,
                  result,
                  redelivered: msg.fields.redelivered,
                },
                result === 'duplicate'
                  ? 'Evento duplicado ignorado'
                  : 'Evento processado',
              );
            } catch (err) {
              messagesTotal.inc({ type, result: 'failed' });
              span.recordException(err as Error);
              span.setStatus({ code: SpanStatusCode.ERROR });
              this.logger.error(
                {
                  event_id: envelope.event_id,
                  err: (err as Error).message,
                  invalid: err instanceof InvalidMessageError,
                },
                'Falha ao processar evento; será reentregue',
              );
              // Backoff exponencial antes do requeue, para dar tempo da dependência voltar
              // sem queimar as 5 entregas permitidas em poucos segundos.
              const deliveryCount = Number(headers['x-delivery-count'] ?? 0);
              await new Promise((r) =>
                setTimeout(r, retryDelayMs(deliveryCount)),
              );
              this.channel.nack(msg, false, true);
            } finally {
              stopTimer();
              span.end();
            }
          },
        ),
      ),
    );
  }

  /** Para de consumir e fecha a conexão no shutdown (mensagens não confirmadas voltam para a fila). */
  async onApplicationShutdown(): Promise<void> {
    setQueueDepthProbe(null);
    await this.channel?.cancelAll().catch(() => undefined);
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
