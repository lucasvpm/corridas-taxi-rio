# corridas · Desafio Técnico Prefeitura do Rio

Versão simplificada do fluxo central do Taxi.Rio. O passageiro solicita a corrida, o motorista aceita, inicia e finaliza, e o status é acompanhado em tempo quase real.

```
 [React UI] ──HTTP+JWT──▶ [API NestJS] ──▶ MySQL (corridas: fonte da verdade)
   :5173  (nginx /api)       :3000   │
                                     └─ publica evento ─▶ [RabbitMQ] ─▶ [Worker NestJS] :3001
                                        exchange topic      quorum + DLQ    ├─▶ Redis (cache de status, CAS por versão)
                                        "corridas"                          └─▶ MongoDB (histórico/auditoria)
 Prometheus :9090 (métricas + alertas) · Jaeger :16686 (traces API → broker → worker)
```

| Documento | Conteúdo |
|---|---|
| [DECISIONS.md](DECISIONS.md) | Decisões, alternativas e trade-offs (inclui RabbitMQ × outros brokers) |
| [DIARIO.md](DIARIO.md) | Diário de bordo: o que quebrou e como investiguei |
| [LIMITES.md](LIMITES.md) | O que ficou de fora, riscos e próximos passos |
| [loadtest/RELATORIO.md](loadtest/RELATORIO.md) | Teste de carga k6: cenário, números e conclusões |

---

## 1. Subir o ambiente

Pré-requisito: **Docker** (com Compose v2).

```bash
docker compose up -d --build
docker compose ps        # aguarde api e worker ficarem (healthy)
```

| Serviço | URL |
|---|---|
| UI | http://localhost:5173 |
| API | http://localhost:3000 |
| RabbitMQ (painel) | http://localhost:15672 (usuário `corridas`, senha `corridas_dev_only`) |
| Prometheus / alertas | http://localhost:9090 · http://localhost:9090/alerts |
| Jaeger | http://localhost:16686 |
| Métricas | http://localhost:3000/metrics · http://localhost:3001/metrics |

> Todas as senhas e chaves do repositório são **de teste**: `*_dev_only` no compose e `scripts/test-keys/`.

## 2. Tokens de teste

Os tokens JWT (RS256) ficam pré-gerados em [`scripts/test-keys/tokens.json`](scripts/test-keys/tokens.json) e valem até 2030:
`passageiro_1`, `passageiro_2`, `motorista_1`, `motorista_2`, além de `expirado` e `assinatura_invalida`, que servem para demonstrar o 401.
A API conhece **só a chave pública**. Para regerar o par de chaves e os tokens: `node scripts/gen-test-keys-and-tokens.mjs`.

```bash
# bash / Git Bash
P1=$(sed -n 's/.*"passageiro_1": "\([^"]*\)".*/\1/p' scripts/test-keys/tokens.json)
P2=$(sed -n 's/.*"passageiro_2": "\([^"]*\)".*/\1/p' scripts/test-keys/tokens.json)
M1=$(sed -n 's/.*"motorista_1": "\([^"]*\)".*/\1/p' scripts/test-keys/tokens.json)
```

## 3. Validar o fluxo

**Roteiro automático** (só precisa de bash + curl), que verifica 401/401/401/200, 403, idempotência, 404, PATCH ×3, 409 e o GET servido pelo cache:

```bash
bash scripts/smoke.sh
```

**Passo a passo manual com curl** (usa as variáveis da seção 2):

```bash
# 401: sem token
curl -i http://localhost:3000/corridas

# 201: cria corrida (Idempotency-Key obrigatória)
curl -i -X POST http://localhost:3000/corridas \
  -H "Authorization: Bearer $P1" -H "Content-Type: application/json" \
  -H "Idempotency-Key: minha-chave-123" \
  -d '{"origem":"Copacabana","destino":"Centro"}'

# 200 + Idempotent-Replayed: true: mesmo POST, mesma chave, mesma corrida (não duplica)
#   (repita o comando acima)

# 403: motorista não cria corrida
curl -i -X POST http://localhost:3000/corridas -H "Authorization: Bearer $M1" \
  -H "Content-Type: application/json" -H "Idempotency-Key: x" -d '{"origem":"A","destino":"B"}'

ID=<id retornado no POST>
# 200: motorista aceita / inicia / finaliza
curl -i -X PATCH http://localhost:3000/corridas/$ID/status -H "Authorization: Bearer $M1" \
  -H "Content-Type: application/json" -d '{"status":"ACEITA"}'
# 403: passageiro não altera status
curl -i -X PATCH http://localhost:3000/corridas/$ID/status -H "Authorization: Bearer $P1" \
  -H "Content-Type: application/json" -d '{"status":"EM_ANDAMENTO"}'

# GET com cache (header X-Cache: HIT/MISS) · 404 para outro passageiro
curl -i http://localhost:3000/corridas/$ID -H "Authorization: Bearer $P1"
curl -i http://localhost:3000/corridas/$ID -H "Authorization: Bearer $P2"
```

**Pela UI** (http://localhost:5173): cole o token `passageiro_1` e crie uma corrida. Em outra aba, cole o `motorista_1`, informe o ID e use Aceitar, Iniciar e Finalizar. A lista do passageiro atualiza sozinha.

**Ver o worker em ação:**

```bash
docker compose exec redis redis-cli GET corrida:$ID                      # snapshot gravado pelo worker
docker compose exec mongo mongosh corridas --quiet --eval \
  "db.eventos_corrida.find({corrida_id:'$ID'}).toArray()"                # histórico (1 doc por evento)
```

**Mensagem duplicada (at-least-once):** no painel do RabbitMQ, vá em *Exchanges › corridas › Publish message*, com routing key `corrida.criada`, e publique duas vezes o mesmo payload copiado de um evento real (aparece no documento do Mongo). Haverá **um** documento no Mongo e o log do worker mostra `Evento duplicado ignorado`. Um payload inválido vai para a fila `worker.corridas.dlq`.

## 4. Testes

Os e2e rodam contra **infra real** (MySQL, Redis, RabbitMQ, Mongo), sem mocks de banco ou broker:

```bash
docker compose up -d mysql redis mongo rabbitmq
cd api    && npm ci && npm run lint && npm test && npm run test:e2e && cd ..
cd worker && npm ci && npm run lint && npm test && npm run test:e2e && cd ..
cd ui     && npm ci && npm run lint && npm run build && cd ..
```

O que está coberto:
- **API, unit:** máquina de estados (todas as transições válidas e inválidas).
- **API, e2e:** fluxo feliz completo; 401 sem token, com assinatura inválida, expirado e com role desconhecido; 403 por papel; 404 em corrida alheia; idempotência (replay, 5 POSTs concorrentes com a mesma chave → 1 linha, 422 com payload diferente); 409 em transição inválida e em dois motoristas aceitando ao mesmo tempo; eventos publicados com envelope e `correlation_id`; `/metrics`.
- **Worker, unit:** validação do envelope.
- **Worker, e2e:** a mesma mensagem duas vezes gera 1 documento; evento antigo fora de ordem não sobrescreve o cache; mensagem malformada vai para a DLQ e a fila continua andando.

**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): a cada push/PR roda lint, unit e e2e (com os serviços como `services:` do Actions), `npm audit` (falha em vulnerabilidade *high*), build das apps e build das 3 imagens Docker.

## 5. Observabilidade (Parte 2)

- **Logs JSON com `correlation_id`.** A API aceita ou gera o `X-Correlation-Id`, devolve no header da resposta, envia no header da mensagem AMQP, e o worker inclui o valor em todos os logs do processamento:
  ```bash
  curl -s -X POST localhost:3000/corridas -H "Authorization: Bearer $P1" -H "Content-Type: application/json" \
    -H "Idempotency-Key: $(date +%s)" -H "X-Correlation-Id: demo-123" -d '{"origem":"A","destino":"B"}'
  docker compose logs api worker | grep demo-123
  ```
- **Métricas Prometheus** (`/metrics`).
  - API: `http_requests_total{method,route,status}` (taxa e erros), `http_request_duration_seconds` (histograma), `corridas_events_published_total`, `corridas_event_publish_failures_total`, `corridas_cache_reads_total{result}`.
  - Worker: `worker_messages_total{type,result}`, `worker_message_processing_seconds`, `worker_event_lag_seconds` (**atraso da fila**: agora − `occurred_at`) e `worker_queue_messages{queue}` (**tamanho da fila** e da DLQ).
  - O Prometheus também coleta as métricas por fila do próprio RabbitMQ.
- **Trace distribuído (OpenTelemetry → Jaeger).** Abra http://localhost:16686, escolha o serviço `corridas-api` e abra um `POST /corridas`. O trace mostra HTTP → MySQL → `corridas publish` → `worker.corridas process` (no serviço `corridas-worker`) → Redis → MongoDB. O `traceparent` atravessa o broker no header da mensagem, com propagação manual nos dois lados.
- **Alertas** ([`observability/alerts.yml`](observability/alerts.yml) e [`alerts-prometheusrule.yaml`](observability/alerts-prometheusrule.yaml), com os mesmos groups), visíveis em http://localhost:9090/alerts:
  1. **`CorridasApiHighErrorRate`**: 5xx > 5% por 5 min, com tráfego > 0.1 req/s. *Por quê:* é o sintoma que o passageiro sente. *Limiar:* abaixo de 5% um blip de deploy ou de rede gera ruído; o piso de tráfego evita alarme com 1 erro em 2 requisições.
  2. **`CorridasStatusPipelineStalled`**: fila `worker.corridas` com mais de 100 mensagens prontas **ou** zero consumidores, por 3 min. *Por quê:* é o incidente silencioso em que a API segue 2xx, mas o status no cache envelhece. Ele lê a métrica do próprio RabbitMQ, então **dispara mesmo com o worker morto**. *Limiar:* calibrado com a vazão medida no k6 (ver relatório).
  - Para ver disparar: `docker compose stop worker`, crie algumas corridas e, em cerca de 3 min, o alerta 2 fica *firing*. Depois, `docker compose start worker`.

## 6. Teste de carga (k6)

```bash
docker compose --profile loadtest run --rm k6
# parâmetros: -e VUS=40 -e DURATION=2m
```

O cenário, os números medidos e as conclusões estão em [loadtest/RELATORIO.md](loadtest/RELATORIO.md).

## 7. Kubernetes (Parte 3)

Requer `kind` e `kubectl`. Os manifests usam Kustomize, em [`k8s/`](k8s/).

```bash
bash k8s/deploy-kind.sh           # cria o cluster kind, builda e carrega as imagens, gera o Secret e aplica
bash k8s/deploy-kind.sh --keda    # idem + KEDA escalando o worker pelo tamanho da fila (bônus)
kubectl -n corridas port-forward svc/api 3000:3000   # e rode scripts/smoke.sh
```

- Probes: `startupProbe` (cobre a migration), `livenessProbe` em `/health/live` (só o processo, para não reiniciar em cascata quando o MySQL cai) e `readinessProbe` em `/health/ready` (MySQL + broker; Redis fora = `degraded`).
- Requests e limits: partem do consumo medido no k6 (ver relatório), com folga para picos.
- Configuração: `ConfigMap` (não sensível) e `Secret` via `secretGenerator` lendo `k8s/base/secrets.env`, que está **no .gitignore**. O script gera senhas aleatórias se o arquivo não existir. Não há credenciais no repositório.

## 8. Estrutura

```
api/            NestJS: auth (JWT RS256 + guards), corridas (idempotência, máquina de estados), cache, messaging, observability
worker/         NestJS: consumer AMQP idempotente → Redis (CAS) + Mongo (histórico), /metrics, /health
ui/             React + Vite + Context API, servida por nginx com proxy /api
scripts/        geração de chaves/tokens de TESTE e smoke test
observability/  prometheus.yml, alerts.yml, alerts-prometheusrule.yaml
loadtest/       script k6 + relatório
k8s/            Kustomize (base + overlay KEDA) e deploy-kind.sh
.github/        CI
```

---

## Declaração de uso de IA

**Ferramenta:** Claude Code (modelo Claude Opus), no terminal e no VS Code.

**Como usei:**
- **Levantamento e escolha das ferramentas:** usei a IA para levantar e comparar as opções para esta aplicação antes de decidir: NestJS ou Node puro, ORM (TypeORM ou Prisma), cliente AMQP (amqplib direto ou o transporte do `@nestjs/microservices`), estratégia de cache e idempotência, e JWT por chave pública ou JWKS. As escolhas e os trade-offs estão no DECISIONS.md.
- **Partes 1 e 2:** a implementação foi feita pelo agente. **O código da API, do worker, da UI, dos testes, do CI, da observabilidade e do k6 foi gerado pelo Claude Code sob minha direção.** Eu defini escopo, prioridades e stack (NestJS, TypeORM, Context API na UI, UI mínima), as regras de commit e o que não publicar, e conduzi a revisão e a validação dos resultados.
- **Parte 3 (Kubernetes + KEDA): feita por agente de IA com harness pesado.** O agente trabalhou com três skills de projeto que adaptei de um projeto Laravel meu para NestJS/React: regras de código, regras de segurança e um *TDD Guardian* (testes contra infra real, proibido alterar teste para passar). Também rodou revisão de código automatizada. Nessa parte, minha intervenção foi mínima.

**Uma sugestão corrigida:** a skill de segurança que eu trazia do projeto Laravel manda responder **sempre 404, nunca 403** para acesso indevido (para não confirmar que o recurso existe). Aplicada ao pé da letra, ela violaria o enunciado, que pede para demonstrar o 403. A regra foi ajustada: **papel errado → 403** (motorista criando corrida, passageiro alterando status) e **corrida de outro passageiro → 404** (proteção contra IDOR). Os dois casos têm teste e estão no DECISIONS.md (#7). Outro exemplo: o `npm install` trouxe por padrão o TypeORM 1.x, recém-lançado. Fixei a linha 0.3.x, que é estável e bem documentada, em vez de apostar numa major nova num desafio com prazo.
