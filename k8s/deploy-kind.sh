#!/usr/bin/env bash
# Sobe o projeto num cluster kind local.
#   bash k8s/deploy-kind.sh          # aplicação
#   bash k8s/deploy-kind.sh --keda   # aplicação + KEDA escalando o worker pela fila
# Requer: docker, kind, kubectl.
set -euo pipefail

CLUSTER=corridas
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEDA_VERSION=2.16.1
WITH_KEDA=false
[[ "${1:-}" == "--keda" ]] && WITH_KEDA=true

if ! kind get clusters | grep -qx "$CLUSTER"; then
  kind create cluster --name "$CLUSTER"
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

# Imagens buildadas localmente e carregadas direto nos nós do kind (sem registry).
for app in api worker ui; do
  docker build -t "corridas-$app:local" "$ROOT/$app"
  kind load docker-image "corridas-$app:local" --name "$CLUSTER"
done

# Chave pública de TESTE (a mesma do docker compose).
cp "$ROOT/scripts/test-keys/public.pem" "$ROOT/k8s/base/jwt-public.pem"

# Credenciais nunca são versionadas: gera senhas aleatórias na primeira execução.
SECRETS="$ROOT/k8s/base/secrets.env"
if [[ ! -f "$SECRETS" ]]; then
  rand() { node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"; }
  DB_PASSWORD="$(rand)"; ROOT_PASSWORD="$(rand)"; MQ_PASSWORD="$(rand)"
  cat > "$SECRETS" <<EOF
DB_PASSWORD=$DB_PASSWORD
MYSQL_ROOT_PASSWORD=$ROOT_PASSWORD
RABBITMQ_DEFAULT_USER=corridas
RABBITMQ_DEFAULT_PASS=$MQ_PASSWORD
AMQP_URL=amqp://corridas:$MQ_PASSWORD@rabbitmq:5672
EOF
  echo "Gerado $SECRETS (gitignored)"
fi

if $WITH_KEDA; then
  kubectl apply --server-side -f "https://github.com/kedacore/keda/releases/download/v${KEDA_VERSION}/keda-${KEDA_VERSION}.yaml"
  kubectl -n keda rollout status deploy/keda-operator --timeout=300s
  kubectl apply -k "$ROOT/k8s/keda"
else
  kubectl apply -k "$ROOT/k8s/base"
fi

# Primeiro a infraestrutura (bancos e broker), depois as aplicações.
for s in mysql mongo rabbitmq; do
  kubectl -n corridas rollout status "statefulset/$s" --timeout=600s
done
for d in redis api worker ui; do
  kubectl -n corridas rollout status "deploy/$d" --timeout=600s
done

cat <<'EOF'

Pronto. Para acessar:
  kubectl -n corridas port-forward svc/api 3000:3000
  kubectl -n corridas port-forward svc/ui 5173:8080
  kubectl -n corridas port-forward svc/rabbitmq 15672:15672
EOF
