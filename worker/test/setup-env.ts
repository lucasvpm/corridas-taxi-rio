import { randomUUID } from 'node:crypto';

// e2e contra RabbitMQ, Redis e MongoDB reais. Filas com nome único por execução,
// para não competir com um worker do docker compose que esteja rodando.
const suffix = randomUUID().slice(0, 8);
process.env.OTEL_SDK_DISABLED = 'true';
process.env.LOG_LEVEL ??= 'silent';
process.env.WORKER_QUEUE = `test.worker.corridas.${suffix}`;
process.env.WORKER_DLX = `test.corridas.dlx.${suffix}`;
process.env.WORKER_DLQ = `test.worker.corridas.dlq.${suffix}`;
process.env.MONGO_DB = 'corridas_test';
