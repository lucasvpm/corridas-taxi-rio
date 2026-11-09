import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as amqplib from 'amqplib';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const PRIVATE_KEY = readFileSync(
  join(__dirname, '..', '..', 'scripts', 'test-keys', 'private.pem'),
  'utf8',
);

interface TokenOptions {
  expiresInSeconds?: number;
  privateKey?: string;
}

/** Assina um JWT RS256 com a chave privada de TESTE (mesmo algoritmo do script de tokens). */
export function signToken(
  sub: string,
  role: string,
  opts: TokenOptions = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    role,
    iss: 'corridas-test-issuer',
    aud: 'corridas-api',
    iat: now,
    exp: now + (opts.expiresInSeconds ?? 3600),
  };
  const enc = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer
    .sign(opts.privateKey ?? PRIVATE_KEY)
    .toString('base64url');
  return `${unsigned}.${signature}`;
}

/** Gera uma chave privada qualquer (diferente da de teste) para simular assinatura inválida. */
export function otherPrivateKey(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

export interface Identity {
  sub: string;
  token: string;
}

/** Passageiro novo por teste, para que os testes não dependam uns dos outros. */
export function newPassageiro(): Identity {
  const sub = `p-${randomUUID()}`;
  return { sub, token: signToken(sub, 'passageiro') };
}

/** Motorista novo por teste. */
export function newMotorista(): Identity {
  const sub = `m-${randomUUID()}`;
  return { sub, token: signToken(sub, 'motorista') };
}

/** Sobe a aplicação Nest completa (mesmo pipeline do main.ts) contra a infra real. */
export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return app;
}

export interface CapturedMessage {
  routingKey: string;
  headers: Record<string, unknown>;
  body: Record<string, any>;
}

export interface EventCapture {
  all: () => CapturedMessage[];
  waitFor: (
    predicate: (m: CapturedMessage) => boolean,
    timeoutMs?: number,
  ) => Promise<CapturedMessage>;
  close: () => Promise<void>;
}

/**
 * Cria uma fila exclusiva e temporária ligada à exchange `corridas` para observar
 * os eventos publicados pela API sem competir com o worker.
 */
export async function captureEvents(): Promise<EventCapture> {
  const conn = await amqplib.connect(
    process.env.AMQP_URL ?? 'amqp://corridas:corridas_dev_only@localhost:5672',
  );
  const ch = await conn.createChannel();
  await ch.assertExchange('corridas', 'topic', { durable: true });
  const { queue } = await ch.assertQueue('', {
    exclusive: true,
    autoDelete: true,
  });
  await ch.bindQueue(queue, 'corridas', 'corrida.*');
  const messages: CapturedMessage[] = [];
  await ch.consume(
    queue,
    (msg) => {
      if (!msg) return;
      messages.push({
        routingKey: msg.fields.routingKey,
        headers: msg.properties.headers ?? {},
        body: JSON.parse(msg.content.toString()) as Record<string, any>,
      });
    },
    { noAck: true },
  );

  return {
    all: () => [...messages],
    waitFor: async (predicate, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('Evento esperado não chegou a tempo');
    },
    close: async () => {
      await ch.close();
      await conn.close();
    },
  };
}
