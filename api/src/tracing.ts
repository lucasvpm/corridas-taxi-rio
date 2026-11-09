import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * Inicializa o OpenTelemetry. PRECISA ser importado antes de qualquer outro módulo
 * (http, express, mysql2, ioredis), porque a auto-instrumentação funciona "embrulhando"
 * esses módulos no momento em que são carregados.
 * Destino: OTEL_EXPORTER_OTLP_ENDPOINT (Jaeger no compose). Desligue com OTEL_SDK_DISABLED=true.
 * A instrumentação automática do amqplib fica desligada: a propagação pelo broker é manual
 * (EventPublisher no produtor e consumer do worker), o que deixa explícito como o trace atravessa a fila.
 */
if (process.env.OTEL_SDK_DISABLED !== 'true') {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'corridas-api',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-amqplib': { enabled: false },
      }),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
}
