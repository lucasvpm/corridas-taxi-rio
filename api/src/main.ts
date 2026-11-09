// O tracing precisa ser o PRIMEIRO import (ver comentário em tracing.ts).
import './tracing';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

/** Sobe a API HTTP. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  const port = Number(app.get(ConfigService).getOrThrow('PORT'));
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
