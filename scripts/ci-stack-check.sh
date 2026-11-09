#!/usr/bin/env bash
# Valida a stack completa do docker compose (o mesmo caminho do README):
# sobe tudo, roda o smoke test, o k6, e confere Prometheus (regras + métricas) e Jaeger (trace API→worker).
# Uso local ou no CI: bash scripts/ci-stack-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PROM=http://localhost:9090
JAEGER=http://localhost:16686
mkdir -p loadtest/results && chmod 777 loadtest/results

echo "::group::docker compose up"
docker compose up -d --build --wait
docker compose ps
echo "::endgroup::"

echo "::group::smoke test"
bash scripts/smoke.sh
echo "::endgroup::"

echo "::group::k6 (com docker stats em paralelo)"
( for _ in $(seq 1 30); do
    docker stats --no-stream --format '{{.Name}};{{.CPUPerc}};{{.MemUsage}}' >> loadtest/results/docker-stats.csv
    sleep 3
  done ) &
STATS_PID=$!
docker compose --profile loadtest run --rm k6 || K6_FAILED=1
kill "$STATS_PID" 2>/dev/null || true
echo "::endgroup::"

echo "::group::Prometheus"
sleep 10
q() { curl -s --get "$PROM/api/v1/query" --data-urlencode "query=$1" | sed -n 's/.*"value":\[[^,]*,"\([^"]*\)"\].*/\1/p' | head -1; }
RULES=$(curl -s "$PROM/api/v1/rules" | grep -o '"name":"Corridas[A-Za-z]*"' | sort -u | tr '\n' ' ')
echo "Regras carregadas: $RULES"
[[ "$RULES" == *CorridasApiHighErrorRate* && "$RULES" == *CorridasStatusPipelineStalled* ]]
{
  echo "api_req_rate_max=$(q 'max_over_time(sum(rate(http_requests_total{job="api"}[30s]))[10m:5s])')"
  echo "api_p95_seconds=$(q 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="api",route!="/metrics"}[3m])))')"
  echo "api_5xx_total=$(q 'sum(http_requests_total{job="api",status=~"5.."}) or vector(0)')"
  echo "worker_msgs_rate_max=$(q 'max_over_time(sum(rate(worker_messages_total[30s]))[10m:5s])')"
  echo "worker_processing_p95_seconds=$(q 'histogram_quantile(0.95, sum by (le) (rate(worker_message_processing_seconds_bucket[3m])))')"
  echo "worker_lag_p95_seconds=$(q 'histogram_quantile(0.95, sum by (le) (rate(worker_event_lag_seconds_bucket[3m])))')"
  echo "worker_lag_p99_seconds=$(q 'histogram_quantile(0.99, sum by (le) (rate(worker_event_lag_seconds_bucket[3m])))')"
  echo "queue_ready_max=$(q 'max_over_time(sum(rabbitmq_detailed_queue_messages_ready{queue="worker.corridas"})[10m:5s])')"
  echo "worker_duplicates=$(q 'sum(worker_messages_total{result="duplicate"}) or vector(0)')"
  echo "worker_failed=$(q 'sum(worker_messages_total{result="failed"}) or vector(0)')"
  echo "publish_failures=$(q 'sum(corridas_event_publish_failures_total) or vector(0)')"
} | tee loadtest/results/prometheus.txt
echo "::endgroup::"

echo "::group::Jaeger"
TRACES_WORKER=$(curl -s "$JAEGER/api/traces?service=corridas-worker&limit=5" | grep -o '"traceID"' | wc -l)
echo "Traces com spans do worker: $TRACES_WORKER"
# Um trace do worker precisa conter também spans da API (mesmo traceID atravessando o broker).
SERVICES=$(curl -s "$JAEGER/api/traces?service=corridas-worker&limit=1" | grep -o '"serviceName":"[a-z-]*"' | sort -u | tr '\n' ' ')
echo "Serviços no trace: $SERVICES"
[[ "$SERVICES" == *corridas-api* && "$SERVICES" == *corridas-worker* ]]
echo "::endgroup::"

echo "::group::Alerta de fila parada (worker desligado)"
docker compose stop worker
sleep 25
STATE=$(curl -s "$PROM/api/v1/alerts" | grep -o '"state":"[a-z]*"' | sort -u | tr '\n' ' ')
ACTIVE=$(curl -s "$PROM/api/v1/alerts" | grep -c CorridasStatusPipelineStalled || true)
echo "Alertas ativos com worker parado: $ACTIVE (estados: ${STATE:-nenhum})"
docker compose start worker
[[ "$ACTIVE" -ge 1 ]]
echo "::endgroup::"

if [[ "${K6_FAILED:-0}" == 1 ]]; then echo "k6 falhou thresholds"; exit 1; fi
echo "Stack OK"
