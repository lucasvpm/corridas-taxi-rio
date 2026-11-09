#!/usr/bin/env bash
# Roteiro de validação ponta a ponta contra o ambiente do docker compose.
# Uso: bash scripts/smoke.sh   (requer só bash + curl)
set -euo pipefail

API="${API:-http://localhost:3000}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TOKENS="$DIR/test-keys/tokens.json"

token() { sed -n "s/.*\"$1\": \"\([^\"]*\)\".*/\1/p" "$TOKENS"; }
PASSAGEIRO=$(token passageiro_1)
PASSAGEIRO_2=$(token passageiro_2)
MOTORISTA=$(token motorista_1)
EXPIRADO=$(token expirado)
INVALIDO=$(token assinatura_invalida)

pass=0; fail=0
check() { # check "descrição" esperado obtido
  if [[ "$2" == "$3" ]]; then echo "  ✔ $1 ($3)"; pass=$((pass+1)); else echo "  ✘ $1: esperado $2, veio $3"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json_field() { sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p"; }

echo "== Autenticação"
check "sem token → 401" 401 "$(code "$API/corridas")"
check "assinatura inválida → 401" 401 "$(code -H "Authorization: Bearer $INVALIDO" "$API/corridas")"
check "token expirado → 401" 401 "$(code -H "Authorization: Bearer $EXPIRADO" "$API/corridas")"
check "token válido → 200" 200 "$(code -H "Authorization: Bearer $PASSAGEIRO" "$API/corridas")"

echo "== Autorização (403)"
check "motorista criando corrida → 403" 403 "$(code -X POST -H "Authorization: Bearer $MOTORISTA" -H 'Content-Type: application/json' -H "Idempotency-Key: smoke-$RANDOM" -d '{"origem":"A","destino":"B"}' "$API/corridas")"

echo "== Criação idempotente"
KEY="smoke-$(date +%s)-$RANDOM"
BODY='{"origem":"Copacabana","destino":"Centro"}'
R1=$(curl -s -w '\n%{http_code}' -X POST -H "Authorization: Bearer $PASSAGEIRO" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY" "$API/corridas")
ID=$(echo "$R1" | head -1 | json_field id)
check "POST cria → 201" 201 "$(echo "$R1" | tail -1)"
R2=$(curl -s -w '\n%{http_code}' -X POST -H "Authorization: Bearer $PASSAGEIRO" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d "$BODY" "$API/corridas")
check "mesmo POST + mesma Idempotency-Key → 200" 200 "$(echo "$R2" | tail -1)"
check "replay devolve a mesma corrida" "$ID" "$(echo "$R2" | head -1 | json_field id)"

echo "== Leitura"
check "outro passageiro lendo → 404" 404 "$(code -H "Authorization: Bearer $PASSAGEIRO_2" "$API/corridas/$ID")"
check "passageiro tentando mudar status → 403" 403 "$(code -X PATCH -H "Authorization: Bearer $PASSAGEIRO" -H 'Content-Type: application/json' -d '{"status":"ACEITA"}' "$API/corridas/$ID/status")"

echo "== Status (motorista)"
for s in ACEITA EM_ANDAMENTO FINALIZADA; do
  check "PATCH $s → 200" 200 "$(code -X PATCH -H "Authorization: Bearer $MOTORISTA" -H 'Content-Type: application/json' -d "{\"status\":\"$s\"}" "$API/corridas/$ID/status")"
done
check "transição inválida → 409" 409 "$(code -X PATCH -H "Authorization: Bearer $MOTORISTA" -H 'Content-Type: application/json' -d '{"status":"ACEITA"}' "$API/corridas/$ID/status")"

echo "== Cache (worker atualiza o Redis via evento)"
STATUS=""
for _ in $(seq 1 20); do
  RESP=$(curl -s -D - -H "Authorization: Bearer $PASSAGEIRO" "$API/corridas/$ID")
  STATUS=$(echo "$RESP" | tail -1 | json_field status)
  CACHE=$(echo "$RESP" | tr -d '\r' | sed -n 's/^[Xx]-[Cc]ache: //p')
  [[ "$STATUS" == "FINALIZADA" ]] && break
  sleep 0.25
done
check "GET reflete FINALIZADA" FINALIZADA "$STATUS"
check "GET servido pelo cache" HIT "$CACHE"

echo
echo "Corrida usada: $ID"
echo "Resultado: $pass ok, $fail falhas"
[[ $fail -eq 0 ]]
