# Relatório do teste de carga (k6)

## Cenário
- **Script:** [`loadtest/corridas.js`](corridas.js). Cada iteração cobre o ciclo de vida completo de uma corrida:
  `POST /corridas` → `POST` repetido com a mesma `Idempotency-Key` (replay) → `GET /corridas/:id` → `PATCH` ACEITA → EM_ANDAMENTO → FINALIZADA (200 ms entre eles) → `GET` em loop até ver `FINALIZADA` (mede a convergência do cache) → 500 ms de pausa.
- **Carga:** `ramping-vus` subindo de 0 a **20 VUs** em 20s, mantendo 20 VUs por 1 min e descendo em 10s. Os VUs se dividem entre `passageiro_1`/`passageiro_2` e `motorista_1`/`motorista_2`.
- **Thresholds:** `http_req_failed < 1%`; p95 do POST e do PATCH < 300 ms; p95 do GET < 150 ms; `checks > 99%`; p95 da convergência do cache < 2 s.
- **Ambiente:** stack completa do `docker-compose.yml` (API, worker, MySQL, Redis, MongoDB, RabbitMQ, Prometheus, Jaeger com tracing **ligado**), rodando num runner `ubuntu-latest` do GitHub Actions (4 vCPU, 16 GB). Execução do job `stack completa`, run [`42547406766`](https://github.com/lucasvpm/corridas-taxi-rio/actions/runs/42547406766). Os artefatos `summary.json`, `prometheus.txt` e `docker-stats.csv` ficam anexados ao run.
  > Rodei no CI porque o Docker da minha máquina estava fora do ar no dia (ver DIARIO). Para reproduzir localmente: `docker compose --profile loadtest run --rm k6`.

## O que medi

| Métrica (k6) | Resultado |
|---|---|
| Requisições | **8.568** (95 req/s em média; pico de 114 req/s visto pelo Prometheus) |
| Corridas completas (iterações) | **1.224** (13,6/s) |
| Falhas HTTP | **0** (0,00%), checks **100%** (8.568/8.568) |
| Latência geral | média 18 ms · mediana 10 ms · **p95 62 ms** · máx 215 ms |
| `POST /corridas` | p95 **84 ms** (média 28 ms) |
| `PATCH /corridas/:id/status` | p95 **75 ms** (média 24 ms) |
| `GET /corridas/:id` | p95 **29 ms** (média 8,6 ms) |
| Convergência do cache após o PATCH final | p95 **25 ms**, máx 74 ms, e **0 casos** que não convergiram |

| Métrica (Prometheus, durante o teste) | Resultado |
|---|---|
| Pico de mensagens processadas pelo worker | **65 msg/s** |
| Processamento por mensagem (Redis CAS + insert no Mongo) | p95 **9 ms** |
| **Atraso da fila** (`worker_event_lag_seconds`: evento na API → processado) | p95 **41 ms** · p99 **49 ms** |
| **Tamanho da fila** `worker.corridas` (máximo de mensagens prontas) | **0** (nunca acumulou) |
| 5xx · mensagens com falha · duplicadas · falhas de publish | 0 · 0 · 0 · 0 |

| Container (`docker stats`, pico) | CPU | Memória |
|---|---|---|
| api | 54% de 1 core | **330 MiB** |
| worker | 14% | 211 MiB |
| rabbitmq | **82%** | 179 MiB |
| mongo | 68% | 232 MiB |
| mysql | 14% | 443 MiB |
| redis | 6% | 5 MiB |

## O que descobri
1. **Nessa carga, o gargalo não é a aplicação.** Com p95 de 62 ms e zero erros, há bastante folga para os thresholds de 300 ms. O worker drena a fila em tempo real: o atraso p95 ficou em 41 ms e a fila nunca passou de 0 mensagens prontas.
2. **Quem mais consome CPU é a infraestrutura de mensageria e auditoria, não a API.** O RabbitMQ chegou a 82% e o Mongo a 68%. A quorum queue replica via Raft e faz fsync a cada mensagem, e esse é o preço da durabilidade escolhida no DECISIONS #2. O Mongo recebe um insert por evento (4 por corrida).
3. **A memória da API foi a surpresa: 330 MiB** com o OpenTelemetry ligado (auto-instrumentação de http, express, mysql2 e ioredis + exportador). O limite de 256 Mi que eu tinha posto nos manifests do Kubernetes derrubaria o pod por OOMKill sob carga. Corrigi os `resources` do k8s com base nesses números (ver abaixo).
4. **A métrica de convergência do k6 mudou de significado depois de uma correção.** Depois do code review, a API passou a gravar o cache no próprio PATCH. Por isso o GET converge em ~25 ms sem depender do worker. O atraso real da cadeia API → broker → worker passou a ser medido pela métrica `worker_event_lag_seconds` do Prometheus, e é ela que importa para o alerta.
5. **O limiar do alerta de fila ficou com uma folga enorme.** Com p95 de 9 ms por mensagem e prefetch de 10, um worker saudável drena 100 mensagens em bem menos de 1 segundo. Fila acima de 100 por 3 minutos só acontece se o worker parou ou degradou de verdade, e é exatamente isso que o alerta `CorridasStatusPipelineStalled` deve pegar. Isso foi comprovado no mesmo job: com o worker parado, o alerta entrou em `pending` em menos de 30 s.

## O que eu mudaria a partir disso
- **Kubernetes:** `api` com requests de 250m/384Mi e limits de 1 CPU/512Mi; `worker` com requests de 100m/256Mi e limits de 500m/384Mi. Fica uma margem de ~50% sobre o pico medido com tracing ligado, já aplicada em `k8s/base`.
- **Achar o ponto de saturação:** rodar um teste em degraus (20 → 50 → 100 → 200 VUs) até o p95 passar de 300 ms. Minha aposta para o primeiro gargalo é o pool de conexões do MySQL (default 10 no TypeORM) ou o RabbitMQ, e não a CPU da API.
- **Se o RabbitMQ virar gargalo:** avaliar publicar com confirmações em lote e, se a durabilidade permitir, fila clássica com mensagens persistentes no lugar da quorum queue. É um trade-off a registrar, não uma mudança automática.
- **Separar o custo do tracing:** repetir o teste com `OTEL_TRACES_SAMPLER=parentbased_traceidratio` a 10% para medir quanto da memória e da latência vem da instrumentação.
- **Teste de resiliência com carga:** derrubar o Redis e o broker no meio do k6 para validar na prática o fallback do GET para o MySQL, o backoff do worker e a métrica `corridas_event_publish_failures_total`.
