import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { Corrida } from './corridas/corrida.entity';
import { CorridasModule } from './corridas/corridas.module';
import { CreateCorridas1731100000000 } from './database/migrations/1731100000000-CreateCorridas';
import { HealthModule } from './health/health.module';
import { MetricsController } from './observability/metrics.controller';

type RequestWithCorrelation = IncomingMessage & { correlationId?: string };

/** Módulo raiz: configuração, logs, banco e módulos de domínio. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.getOrThrow<string>('LOG_LEVEL'),
          // O id do log de requisição é o próprio correlation_id (definido no correlationMiddleware).
          genReqId: (req: RequestWithCorrelation) =>
            req.correlationId ?? 'sem-correlation-id',
          customProps: (req: RequestWithCorrelation) => ({
            correlation_id: req.correlationId,
          }),
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: {
            ignore: (req: IncomingMessage) =>
              req.url === '/metrics' || (req.url ?? '').startsWith('/health'),
          },
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.getOrThrow<string>('DB_HOST'),
        port: Number(config.getOrThrow('DB_PORT')),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        entities: [Corrida],
        migrations: [CreateCorridas1731100000000],
        // Migrations rodam no boot (simples para o desafio). Em produção seria um Job separado.
        migrationsRun: true,
        synchronize: false,
        timezone: 'Z',
      }),
    }),
    AuthModule,
    CorridasModule,
    HealthModule,
  ],
  controllers: [MetricsController],
})
export class AppModule {}
