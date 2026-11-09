// O tracing precisa ser o PRIMEIRO import (ver tracing.ts).
import './tracing';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/** Sobe o worker (consumer AMQP + HTTP mínimo para /health e /metrics). */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const port = Number(app.get(ConfigService).getOrThrow('PORT'));
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
