#!/usr/bin/env node
/**
 * ⚠️ SOMENTE TESTE. Gera um par de chaves RS256 e tokens JWT estáticos para o desafio.
 * A chave privada fica versionada de propósito (o enunciado pede "token estático pré-gerado"
 * e permite chaves de exemplo claramente de teste). NUNCA reutilize estas chaves.
 *
 * Uso: node scripts/gen-test-keys-and-tokens.mjs   (sem dependências; só node:crypto)
 * Saída: scripts/test-keys/{private.pem, public.pem, tokens.json}
 */
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ISSUER = 'corridas-test-issuer';
const AUDIENCE = 'corridas-api';
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'test-keys');

/** Codifica em base64url (formato usado pelo JWT). */
function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Assina um JWT RS256 manualmente: base64url(header).base64url(payload).assinatura. */
export function signJwt(payload, privateKeyPem) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(privateKeyPem).toString('base64url')}`;
}

/** Gera um par RSA 2048 em PEM. */
function newKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

const { publicKey, privateKey } = newKeyPair();
const attacker = newKeyPair(); // chave "errada" para o cenário de assinatura inválida

const now = Math.floor(Date.now() / 1000);
const exp2030 = Math.floor(Date.UTC(2030, 0, 1) / 1000);
const base = { iss: ISSUER, aud: AUDIENCE, iat: now };

const tokens = {
  passageiro_1: signJwt({ ...base, sub: 'passageiro-1', role: 'passageiro', exp: exp2030 }, privateKey),
  passageiro_2: signJwt({ ...base, sub: 'passageiro-2', role: 'passageiro', exp: exp2030 }, privateKey),
  motorista_1: signJwt({ ...base, sub: 'motorista-1', role: 'motorista', exp: exp2030 }, privateKey),
  motorista_2: signJwt({ ...base, sub: 'motorista-2', role: 'motorista', exp: exp2030 }, privateKey),
  expirado: signJwt({ ...base, sub: 'passageiro-1', role: 'passageiro', exp: now - 3600 }, privateKey),
  assinatura_invalida: signJwt(
    { ...base, sub: 'passageiro-1', role: 'passageiro', exp: exp2030 },
    attacker.privateKey,
  ),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'public.pem'), publicKey);
writeFileSync(join(outDir, 'private.pem'), privateKey);
writeFileSync(join(outDir, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`);
console.log(`Chaves e tokens de TESTE gerados em ${outDir}`);
