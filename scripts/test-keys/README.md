# ⚠️ Chaves e tokens SOMENTE DE TESTE

Gerados por `node scripts/gen-test-keys-and-tokens.mjs`. Ficam versionados de propósito, para que
o avaliador consiga rodar o projeto só com Docker (o enunciado pede "token estático pré-gerado").

- `public.pem`: a única chave que a API conhece (verificação RS256).
- `private.pem`: usada só pelo script e pelos testes e2e para assinar tokens. **Nunca use fora deste desafio.**
- `tokens.json`: tokens válidos até 2030-01-01 (`iss=corridas-test-issuer`, `aud=corridas-api`):
  `passageiro_1`, `passageiro_2`, `motorista_1`, `motorista_2`, além de `expirado` e
  `assinatura_invalida` (assinado com outra chave) para demonstrar o 401.
