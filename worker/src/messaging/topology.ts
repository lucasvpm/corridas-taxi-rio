import type { Channel } from 'amqplib';

export const EXCHANGE = 'corridas';

export interface TopologyNames {
  queue: string;
  dlx: string;
  dlq: string;
}

/**
 * Declara a topologia (idempotente). Com os nomes default, os argumentos são IDÊNTICOS
 * aos que a API declara em api/src/messaging/topology.ts — se divergirem, o broker recusa.
 *
 * - `corridas` (topic): a API publica com routing key corrida.criada / corrida.status_alterado.
 * - fila quorum com x-delivery-limit=5: erro transitório faz nack com requeue; na 6ª entrega
 *   o próprio RabbitMQ manda a mensagem para a DLX (sem loop infinito de reprocessamento).
 * - DLX fanout → DLQ: mensagens venenosas ficam guardadas para inspeção manual.
 */
export async function assertTopology(
  ch: Channel,
  names: TopologyNames,
): Promise<void> {
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(names.dlx, 'fanout', { durable: true });
  await ch.assertQueue(names.dlq, { durable: true });
  await ch.bindQueue(names.dlq, names.dlx, '');
  await ch.assertQueue(names.queue, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': 5,
      'x-dead-letter-exchange': names.dlx,
    },
  });
  await ch.bindQueue(names.queue, EXCHANGE, 'corrida.*');
}
