import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';
const VALID_ID = /^[A-Za-z0-9._-]{1,100}$/;

interface CorrelationContext {
  correlationId: string;
}

/**
 * Guarda o correlation_id da requisição atual. AsyncLocalStorage funciona como uma
 * "variável global por requisição" que atravessa awaits sem precisar passar por parâmetro.
 */
const storage = new AsyncLocalStorage<CorrelationContext>();

/** Retorna o correlation_id da requisição atual (ou undefined fora de uma requisição). */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Middleware Express: reaproveita o X-Correlation-Id do cliente (se for válido) ou gera um novo,
 * devolve no header da resposta e abre o contexto do AsyncLocalStorage para o resto da requisição.
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(CORRELATION_HEADER);
  const correlationId =
    incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  (req as Request & { correlationId: string }).correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);
  storage.run({ correlationId }, next);
}
