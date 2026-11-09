import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * OpenTelemetry do worker. Deve ser o primeiro import do main.ts.
 * ioredis e mongodb são auto-instrumentados; o span de consumo é criado manualmente
 * no ConsumerService a partir do traceparent que veio no header da mensagem.
 */
if (process.env.OTEL_SDK_DISABLED !== 'true') {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'corridas-worker',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-amqplib': { enabled: false },
        // Não gera spans para os scrapes de /metrics e probes de /health.
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: () => true,
        },
      }),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
}
