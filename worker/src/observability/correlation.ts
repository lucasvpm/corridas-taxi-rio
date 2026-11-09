import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ correlationId: string }>();

/** Executa `fn` com o correlation_id da mensagem disponível para todos os logs abaixo dela. */
export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** Correlation_id da mensagem sendo processada (undefined fora do processamento). */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
