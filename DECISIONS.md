# Registro de Decisões

Formato: **Contexto · Alternativas · Decisão · Trade-off aceito.**

---

## 1. Se eu começasse do zero: RabbitMQ ou outro broker? *(entrada obrigatória)*

**Contexto.** Os eventos são operacionais (corrida criada, status mudou), com volume moderado (uma cidade, não um feed global) e cada um precisa ser processado **uma vez com sucesso**: atualizar cache e gravar auditoria. A exigência de "quase tempo real" pede baixa latência por mensagem. O enunciado também pede escalar o worker pelo tamanho da fila.

**Alternativas.**
- **Kafka**: log particionado com retenção e replay, throughput altíssimo e ordenação por partição. Em troca, opera mais peças, não tem ack/DLQ por mensagem nativos (retry e DLQ viram código ou tópicos extras), e o "tamanho da fila" vira lag de consumer group por partição. O paralelismo fica limitado ao número de partições.
- **SQS/SNS ou Pub/Sub**: ótimos se a nuvem já estivesse definida, com zero operação. Prendem a um provedor e não rodam no `docker compose` sem emulador.
- **Redis Streams**: já temos Redis, mas misturar cache e mensageria aumenta o raio de impacto, e as garantias de durabilidade são mais fracas.
- **NATS JetStream**: leve e rápido, mas com ecossistema menor (KEDA, operação, conhecimento do time).

**Decisão.** **Manteria o RabbitMQ.** Ele resolve exatamente o problema: roteamento por tópico (`corrida.*`), ack manual por mensagem, DLX/DLQ nativos, **quorum queues** com `x-delivery-limit` (poison message tratada pelo próprio broker), scaler pronto no KEDA e baixa latência. Kafka passaria a valer a pena se surgisse necessidade de **replay** de eventos (reconstruir projeções, event sourcing), de muitos consumidores independentes lendo o mesmo histórico, ou de throughput na casa de dezenas de milhares de msg/s. Mesmo nesse caso, eu avaliaria **RabbitMQ Streams** antes de trocar de tecnologia.

**Trade-off.** Mensagem consumida não pode ser relida, então o histórico "replayável" fica no MongoDB (auditoria), não no broker. Em cluster, o RabbitMQ pede atenção a quorum e memória.

---

## 2. Topologia do RabbitMQ

**Contexto.** Hoje existe um consumidor (o worker), mas amanhã podem surgir outros, como notificações ou billing. É preciso tratar mensagem venenosa sem travar a fila.

**Alternativas.** Fila direta sem exchange; exchange `fanout`; `topic`. Para retry: requeue infinito, fila de retry com TTL, ou quorum queue com `delivery-limit`.

**Decisão.**
- Exchange **`corridas` (topic, durável)**, com routing keys `corrida.criada` e `corrida.status_alterado`. Um consumidor novo cria a própria fila e faz o bind só no que interessa, sem mudar a API.
- Fila **`worker.corridas` (quorum)**, com bind em `corrida.*`, `x-delivery-limit=5` e `x-dead-letter-exchange=corridas.dlx`.
- **`corridas.dlx` (fanout) → `worker.corridas.dlq`**.
- O worker trabalha com **ack manual e prefetch=10**. Mensagem malformada recebe `nack` sem requeue e vai direto para a DLQ. Erro transitório (Redis ou Mongo fora) recebe `nack` com requeue depois de um backoff exponencial pelo `x-delivery-count` (2s, 4s, 8s, 16s, teto de 30s); na 6ª entrega o broker manda para a DLQ sozinho.
- A topologia é declarada **pela API e pelo worker** (declarações são idempotentes). Assim, se a API subir e publicar antes do worker existir, a mensagem não é descartada como "unroutable".

**Trade-off.** Os argumentos da fila ficam duplicados em dois serviços, e precisam ser idênticos, senão o broker recusa com `PRECONDITION_FAILED`. Ficou comentado nos dois arquivos `topology.ts`. O backoff é feito segurando a mensagem no processo antes do `nack`, o que ocupa um lugar do prefetch durante a espera; filas de retry com TTL tirariam essa espera do worker (ver LIMITES.md).

---

## 3. Idempotência: banco, aplicação ou ambos?

**Contexto.** Os pontos de duplicação são dois: o **POST** repetido pelo cliente (timeout, clique duplo) e a **mensagem reentregue** pelo broker (at-least-once).

**Alternativas.** Só na aplicação (consultar antes de inserir), que é vulnerável a condição de corrida; só no banco (UNIQUE), que é correto mas devolve erro feio; ou guardar a resposta numa tabela de idempotência com TTL (padrão Stripe).

**Decisão.** **Ambos.**
- **POST:** `UNIQUE(passageiro_id, idempotency_key)` no MySQL é a garantia. A aplicação faz uma consulta prévia para responder rápido, e, se duas requisições iguais passarem juntas pela consulta, o `ER_DUP_ENTRY` da segunda vira replay. O replay devolve **200** com `Idempotent-Replayed: true` e a mesma corrida. A mesma key com payload diferente dá **422**. A key vale por passageiro, então dois passageiros podem usar o mesmo valor sem colidir.
- **Worker:** Redis com **compare-and-set por versão** (script Lua atômico) e Mongo com **`_id = event_id`**, em que duplicata vira erro 11000 e é ignorada. A ordem Redis → Mongo → ack é proposital: se o processo morrer entre os dois passos, a reentrega ainda atualiza o cache.

**Trade-off.** A key não expira (vive enquanto a corrida existir) e o header é obrigatório no POST. Não guardo o corpo da resposta original; o replay devolve o **estado atual** da corrida, que pode já ter mudado de status. Para este domínio, isso é até mais útil.

---

## 4. Cache: cache-aside ou write-through?

**Contexto.** O enunciado separa os papéis: a API lê com cache e o worker atualiza o cache. Leituras de status (polling da UI) são muito mais frequentes que escritas.

**Alternativas.** Write-through na API (grava MySQL e Redis no PATCH); invalidar o cache no PATCH; ou cache atualizado por eventos.

**Decisão.** **Atualização por eventos no worker + cache-aside na leitura da API + escrita da API no PATCH.** O worker grava o snapshot a cada evento. No `GET`, a API lê do Redis e, em MISS, busca no MySQL e popula. No `PATCH`, logo após o commit, a própria API grava o novo snapshot. Essa escrita entrou depois do code review: sem ela, uma publicação perdida deixaria o GET preso no status antigo até o TTL. As duas escritas usam o mesmo **CAS por versão**, então uma escrita velha nunca sobrescreve uma nova, venha de quem vier. Se o Redis cair, o GET lê direto do MySQL (o readiness reporta `degraded`, não `down`).

**Trade-off.** São duas fontes escrevendo no cache (API e worker). Isso só é seguro por causa do CAS por versão. O worker continua sendo quem garante o cache para eventos vindos de qualquer produtor; a escrita da API é uma rede de segurança. A janela de inconsistência fica restrita a uma falha de Redis no momento do PATCH, coberta pelo TTL e pelo alerta `CorridasStatusPipelineStalled`. A chave guarda `passageiro_id` para a checagem de dono funcionar mesmo no HIT.

---

## 5. Por que MySQL para corridas e MongoDB para histórico?

**Contexto.** As corridas têm estado transacional com invariantes (transições, um motorista por corrida, unicidade). O histórico é append-only, com formato que muda conforme o tipo de evento.

**Decisão.** **MySQL** é a fonte da verdade: transação, `UNIQUE`, `ENUM` de status e update condicional por `status + version`, que impede dois motoristas de aceitarem a mesma corrida (um 200, o outro 409). **MongoDB** fica com a auditoria: um documento por evento com o snapshot inteiro, índice por `corrida_id`, sem migration a cada campo novo.

**Trade-off.** Mais uma tecnologia para operar, e o histórico não é consultado na mesma transação que a corrida. Daria para gravar a auditoria numa tabela MySQL, mas o enunciado define o Mongo e a separação isola a carga de escrita da auditoria.

---

## 6. Publicar evento depois do commit (e não usar Outbox)

**Contexto.** Gravar no MySQL e publicar no RabbitMQ são duas escritas sem transação comum (*dual write*).

**Alternativas.** Publicar antes do commit (pode anunciar uma corrida que não existe); publicar depois do commit (pode perder o evento se o broker falhar); **Transactional Outbox** (grava o evento numa tabela na mesma transação e um relay publica).

**Decisão.** **Publicar depois do commit**, com *confirm channel* e timeout de 5s. Se o broker não confirmar, a requisição **não falha** (a corrida existe), mas o erro vai para o log com o `event_id` e para a métrica `corridas_event_publish_failures_total`. O `amqp-connection-manager` reconecta e bufferiza durante quedas curtas.

**Trade-off.** Existe uma janela de **perda de evento**. Nesse caso o cache se corrige no próximo MISS (cache-aside), mas o histórico no Mongo fica com um buraco. O Outbox é a correção certa e está no LIMITES.md. Optei por não implementá-lo para manter a Parte 1 sólida dentro do tempo.

---

## 7. JWT: chave pública estática vs JWKS; 403 vs 404

**Contexto.** O enunciado pede token estático pré-gerado validado por JWKS ou chave pública, e pede para demonstrar o 403.

**Decisão.**
- **RS256 com chave pública em arquivo** montado na API. JWKS faz sentido quando existe um emissor real (IdP) e rotação de chaves. Aqui o emissor é um script de teste, e subir um servidor JWKS só para servir um arquivo seria cerimônia. A API fixa `algorithms: ['RS256']` (evita *algorithm confusion*) e valida `exp`, `iss` e `aud`.
- **Papel errado → 403** (motorista criando, passageiro alterando status). **Corrida de outro passageiro → 404**, para não confirmar a existência do recurso (IDOR). A skill de segurança que usei dizia "sempre 404"; adaptei, porque o enunciado exige o 403 para violação de papel.
- Interpretação do enunciado: "motorista só altera status" foi lido de forma estrita. O motorista **não lê** corrida via `GET /corridas/:id` (recebe 403). Na primeira versão da UI ele informava o ID da corrida; a entrada 8 abriu uma exceção mínima para ele ver a lista do que pode aceitar.

**Trade-off.** Rotacionar a chave exige redeploy, o que não aconteceria com JWKS. Com JWKS, bastaria publicar a chave nova. A troca é localizada: só a `JwtStrategy` muda (por exemplo, para `passport-jwt` + `jwks-rsa`).

---

## 8. O motorista enxerga as corridas disponíveis?

**Contexto.** Com a leitura estrita da entrada 7, o motorista não lia nenhuma corrida e precisava colar na UI o ID copiado da tela do passageiro. No uso real isso não existe: o motorista só aceita o que consegue ver. O enunciado diz que o motorista "só altera status", e permite escolher uma interpretação razoável quando algo é ambíguo, desde que registrada aqui.

**Alternativas.**
- **Manter a leitura estrita** (colar o ID): fiel ao texto, mas a tela fica artificial e a demonstração depende de copiar e colar UUID.
- **Liberar o `GET /corridas/:id` e o `GET /corridas` para o motorista:** simples, mas entrega o `passageiro_id` e qualquer corrida a qualquer motorista.
- **Rota própria, só leitura e com o mínimo** (a escolhida).
- **Push em vez de polling** (WebSocket ou SSE com o worker avisando): melhor experiência, mas exige conexões abertas e um canal worker → API. Fica para depois.

**Decisão.** `GET /motorista/corridas` (só `motorista`) devolve duas listas: `em_curso` (as dele, `ACEITA` ou `EM_ANDAMENTO`) e `disponiveis` (todas as `SOLICITADA`, até 50, mais recentes primeiro). Cada item traz o `proximo_status`, calculado pela mesma máquina de estados do PATCH, então a UI não repete as regras. **Nenhum item tem `passageiro_id`.** A resposta do PATCH passou a usar essa mesma visão, porque não fazia sentido esconder o passageiro na lista e mostrar na resposta da ação. O `GET /corridas/:id` continua dando 403 para o motorista. A lista lê do MySQL (o cache guarda corridas individuais, não listas), com dois índices novos numa migration: `(status, created_at)` e `(motorista_id, status)`. Dois motoristas aceitando a mesma corrida continuam caindo no UPDATE condicional (um 200, um 409), e a UI traduz esse 409 como "outro motorista aceitou antes de você".

**Trade-off.** A regra "motorista só altera status" ganha uma exceção de leitura, limitada ao que é necessário para aceitar. Sem localização não existe despacho de verdade: todos os motoristas veem todas as corridas abertas, e a ordem "mais recentes primeiro" foi escolhida para que um pedido novo sempre apareça, não por justiça com quem espera há mais tempo. A UI consulta a cada 2 s, o que é uma consulta indexada por motorista conectado; com muitos motoristas, o caminho seria push ou um cache curto da lista.
