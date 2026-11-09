import type { NextFunction, Request, Response } from 'express';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  register,
} from 'prom-client';

collectDefaultMetrics({ register });

/** Total de requisições HTTP. Taxa = rate(); erros = filtro status=~"5..". */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP',
  labelNames: ['method', 'route', 'status'],
});

/** Latência das requisições HTTP em segundos (histograma para calcular p95/p99). */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latência das requisições HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/** Falhas ao publicar eventos no RabbitMQ (sintoma do problema de dual write). */
export const eventPublishFailures = new Counter({
  name: 'corridas_event_publish_failures_total',
  help: 'Eventos que não foram confirmados pelo broker',
  labelNames: ['type'],
});

/** Eventos publicados e confirmados pelo broker. */
export const eventsPublished = new Counter({
  name: 'corridas_events_published_total',
  help: 'Eventos publicados e confirmados pelo broker',
  labelNames: ['type'],
});

/** Leituras do GET /corridas/:id por resultado de cache. */
export const cacheReads = new Counter({
  name: 'corridas_cache_reads_total',
  help: 'Leituras de corrida por resultado de cache',
  labelNames: ['result'],
});

/**
 * Middleware Express que mede toda requisição no evento `finish`. Fica fora dos guards
 * do Nest de propósito, para contar também respostas 401/403.
 * O label `route` usa o padrão da rota (/corridas/:id), nunca a URL crua, para não explodir a cardinalidade.
 */
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const stop = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const routePath = (req.route as { path?: string } | undefined)?.path;
    const route = routePath ? `${req.baseUrl}${routePath}` : 'unmatched';
    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    stop(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
}
