import type { ConfirmChannel } from 'amqplib';

/**
 * Topologia do RabbitMQ. É declarada pela API e pelo worker (declarações são idempotentes),
 * assim a fila já existe mesmo se a API publicar antes do worker subir pela primeira vez.
 * Os argumentos precisam ser IDÊNTICOS nos dois lados, senão o broker recusa (PRECONDITION_FAILED).
 */
export const EXCHANGE = 'corridas';
export const DLX = 'corridas.dlx';
export const QUEUE = 'worker.corridas';
export const DLQ = 'worker.corridas.dlq';
export const ROUTING_KEYS = {
  criada: 'corrida.criada',
  statusAlterado: 'corrida.status_alterado',
} as const;
export type RoutingKey = (typeof ROUTING_KEYS)[keyof typeof ROUTING_KEYS];

/**
 * Declara exchange topic, DLX, fila quorum com delivery-limit (após 5 entregas falhas vai para a DLQ)
 * e a DLQ clássica.
 */
export async function assertTopology(ch: ConfirmChannel): Promise<void> {
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'fanout', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, '');
  await ch.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': 5,
      'x-dead-letter-exchange': DLX,
    },
  });
  await ch.bindQueue(QUEUE, EXCHANGE, 'corrida.*');
}
