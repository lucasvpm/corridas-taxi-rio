import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  register,
} from 'prom-client';

collectDefaultMetrics({ register });

/**
 * Mensagens consumidas por tipo e resultado:
 * processed | duplicate (reentrega já vista) | invalid (foi para a DLQ) | failed (será reentregue).
 */
export const messagesTotal = new Counter({
  name: 'worker_messages_total',
  help: 'Mensagens consumidas por tipo e resultado',
  labelNames: ['type', 'result'],
});

/** Tempo de processamento de uma mensagem (Redis + Mongo). */
export const processingSeconds = new Histogram({
  name: 'worker_message_processing_seconds',
  help: 'Tempo de processamento de uma mensagem',
  labelNames: ['type'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

/** Atraso fim a fim: agora - occurred_at do evento (quanto o status no cache está atrasado). */
export const eventLagSeconds = new Histogram({
  name: 'worker_event_lag_seconds',
  help: 'Atraso entre o evento acontecer na API e ser processado pelo worker',
  labelNames: ['type'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
});

type QueueDepthProbe = () => Promise<Array<{ queue: string; count: number }>>;
let queueDepthProbe: QueueDepthProbe | null = null;

/** Registra (ou remove) a função que consulta o tamanho das filas no broker. */
export function setQueueDepthProbe(probe: QueueDepthProbe | null): void {
  queueDepthProbe = probe;
}

/**
 * Tamanho da fila (mensagens prontas), consultado no broker a cada scrape via checkQueue.
 * Se o broker não responder em 2s, mantém o último valor.
 */
export const queueMessages = new Gauge({
  name: 'worker_queue_messages',
  help: 'Mensagens prontas aguardando consumo na fila',
  labelNames: ['queue'],
  async collect() {
    if (!queueDepthProbe) return;
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2000),
      );
      const depths = await Promise.race([queueDepthProbe(), timeout]);
      for (const { queue, count } of depths) this.set({ queue }, count);
    } catch {
      // Broker indisponível: o alerta de fila usa a métrica do próprio RabbitMQ.
    }
  },
});
