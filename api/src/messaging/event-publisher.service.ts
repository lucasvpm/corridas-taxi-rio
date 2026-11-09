import { randomUUID } from 'node:crypto';
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
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import * as amqp from 'amqp-connection-manager';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { CorridaView } from '../corridas/corrida.view';
import { getCorrelationId } from '../observability/correlation';
import {
  eventPublishFailures,
  eventsPublished,
} from '../observability/metrics';
import { assertTopology, EXCHANGE, RoutingKey } from './topology';

/** Envelope de todo evento publicado. `event_id` deduplica no worker; `version` ordena. */
export interface EventEnvelope {
  event_id: string;
  type: RoutingKey;
  occurred_at: string;
  corrida_id: string;
  version: number;
  data: CorridaView & { previous_status?: string };
}

const tracer = trace.getTracer('corridas-api');

/**
 * Publica eventos de corrida no RabbitMQ usando confirm channel:
 * a promise só resolve quando o broker confirma (ack) que guardou a mensagem.
 * O amqp-connection-manager reconecta sozinho se o broker cair.
 */
@Injectable()
export class EventPublisher implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EventPublisher.name);
  private connection!: AmqpConnectionManager;
  private channel!: ChannelWrapper;

  /** Recebe a configuração (URL do broker). */
  constructor(private readonly config: ConfigService) {}

  /** Abre conexão e canal; o `setup` roda de novo a cada reconexão. */
  onModuleInit(): void {
    this.connection = amqp.connect(
      [this.config.getOrThrow<string>('AMQP_URL')],
      {
        heartbeatIntervalInSeconds: 10,
        reconnectTimeInSeconds: 2,
      },
    );
    this.connection.on('connect', () =>
      this.logger.log('Conectado ao RabbitMQ'),
    );
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn({ err: err?.message }, 'Desconectado do RabbitMQ'),
    );
    this.channel = this.connection.createChannel({
      confirm: true,
      setup: (ch: ConfirmChannel) => assertTopology(ch),
    });
  }

  /** Diz se há conexão ativa com o broker (usado no readiness). */
  isConnected(): boolean {
    return this.connection?.isConnected() ?? false;
  }

  /**
   * Publica um evento após o commit no MySQL. Se o broker não confirmar em 5s, registra
   * métrica e log de erro mas NÃO falha a requisição: a corrida já existe na fonte da verdade.
   * Essa janela de perda (dual write) está documentada em LIMITES.md; a correção é o padrão Outbox.
   */
  async publish(
    type: RoutingKey,
    corrida: CorridaView,
    previousStatus?: string,
  ): Promise<EventEnvelope> {
    const envelope: EventEnvelope = {
      event_id: randomUUID(),
      type,
      occurred_at: new Date().toISOString(),
      corrida_id: corrida.id,
      version: corrida.version,
      data: previousStatus
        ? { ...corrida, previous_status: previousStatus }
        : corrida,
    };

    await tracer.startActiveSpan(
      `${EXCHANGE} publish`,
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          'messaging.system': 'rabbitmq',
          'messaging.destination.name': EXCHANGE,
          'messaging.rabbitmq.destination.routing_key': type,
          'messaging.message.id': envelope.event_id,
          'corrida.id': corrida.id,
        },
      },
      async (span) => {
        const headers: Record<string, string> = {};
        const correlationId = getCorrelationId();
        if (correlationId) headers.correlation_id = correlationId;
        // Propagação W3C (traceparent) manual: o worker extrai e continua o mesmo trace.
        propagation.inject(context.active(), headers);
        try {
          await this.channel.publish(
            EXCHANGE,
            type,
            Buffer.from(JSON.stringify(envelope)),
            {
              persistent: true,
              contentType: 'application/json',
              messageId: envelope.event_id,
              type,
              timestamp: Math.floor(Date.now() / 1000),
              headers,
              timeout: 5000,
            },
          );
          eventsPublished.inc({ type });
          this.logger.log(
            { event_id: envelope.event_id, type, corrida_id: corrida.id },
            'Evento publicado',
          );
        } catch (err) {
          eventPublishFailures.inc({ type });
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          this.logger.error(
            {
              event_id: envelope.event_id,
              type,
              corrida_id: corrida.id,
              err: (err as Error).message,
            },
            'Falha ao publicar evento',
          );
        } finally {
          span.end();
        }
      },
    );
    return envelope;
  }

  /** Fecha canal e conexão no shutdown. */
  async onApplicationShutdown(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
