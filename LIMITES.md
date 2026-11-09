# Limites, Riscos e Próximos Passos

## O que ficou de fora ou simplificado
- **Transactional Outbox.** O evento é publicado depois do commit. Se o broker não confirmar em 5s, o evento se perde (fica registrado em log e na métrica `corridas_event_publish_failures_total`). O cache se corrige no próximo MISS, mas o histórico no Mongo fica com um buraco. Próximo passo: tabela `outbox` na mesma transação e um relay publicando com confirm.
- **Rate limiting.** Não implementado, de propósito, para o k6 medir a aplicação e não o limitador. Em produção: `@nestjs/throttler` com storage Redis, chaveado por `sub` do token.
- **JWKS / rotação de chave.** A chave pública é estática, então trocar a chave exige redeploy.
- **Migrations no boot da API.** Simples para o desafio. Com várias réplicas, as migrations deveriam rodar num Job separado antes do rollout (hoje o TypeORM usa lock, mas atrasa o startup).
- **Retry dentro do worker.** O backoff exponencial (2s→30s) é feito segurando a mensagem no processo antes do nack, o que ocupa um slot do prefetch. Filas de retry com TTL seriam mais robustas. A DLQ não tem ferramenta de reprocessamento; o "shovel" é manual pelo painel.
- **UI sem testes automatizados.** O CI faz lint e build. O fluxo da UI foi validado manualmente.
- **Replay idempotente devolve o estado atual**, não o corpo original da resposta.
- **KEDA: escala sob carga não demonstrada.** O CI valida no kind que o `ScaledObject` fica Ready e que o KEDA cria o HPA do worker (1 a 5 réplicas, alvo de 20 mensagens por réplica). Mas, na carga do k6, o worker nunca deixou a fila acumular (p95 de 9 ms por mensagem), então não houve gatilho para escalar. Para demonstrar seria preciso gerar backlog de propósito (por exemplo, um burst de publicações maior que a vazão de 1 réplica, ou um atraso artificial no handler) e observar `kubectl get hpa -w`.
- **Observabilidade no Kubernetes.** Os manifests não sobem Prometheus nem Jaeger no kind (o OTel fica desligado lá). A regra está pronta como `PrometheusRule`, para um cluster com Prometheus Operator.
- **Sem TLS nem autenticação forte** em Redis e Mongo, e senhas de desenvolvimento no `docker-compose.yml` (marcadas como `*_dev_only`). No k8s as credenciais vêm de Secret gerado fora do repositório.

## Riscos conhecidos
- **Consistência eventual do GET.** A API grava o cache no PATCH, mas, se o Redis falhar exatamente nesse momento, o GET depende do worker processar o evento (ou do TTL).
- **Delivery tag após reconexão.** Se a conexão com o broker cair enquanto uma mensagem está no handler, o ack é enviado num canal novo e o broker fecha esse canal com "unknown delivery tag". A mensagem é reentregue e tratada como duplicada, então não há perda, mas há um ciclo extra de reconexão.
- **Script Lua e topologia duplicados** entre API e worker. Se alguém mudar os argumentos da fila de um lado só, o broker recusa a declaração (`PRECONDITION_FAILED`). Um pacote compartilhado eliminaria esse risco.
- **Vulnerabilidades moderadas** no `glob`/`minimatch` usados internamente pelo TypeORM 0.3 (só somem migrando para o TypeORM 1.x, que é breaking). As "high" foram zeradas, inclusive com override do `multer` para 2.5.0.
- **Ordem de eventos** é garantida só para o cache (CAS por versão). O histórico grava na ordem de chegada; a ordem lógica vem do campo `version`.

## O que eu faria com mais tempo
1. Outbox + relay, com teste de caos derrubando o broker no meio do POST.
2. Endpoint `GET /corridas/:id/historico` lendo do Mongo, para a auditoria ficar consultável.
3. Teste de contrato do envelope do evento compartilhado entre API e worker (hoje o formato está duplicado em dois `types`).
4. Testes de UI (Vitest + Testing Library) e um e2e de navegador (Playwright).
5. Dashboards Grafana versionados e SLOs formais (burn rate) no lugar do limiar fixo de 5%.
6. Prometheus Operator + Jaeger no kind para fechar a observabilidade também no cluster.
