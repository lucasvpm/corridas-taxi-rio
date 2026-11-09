import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { CorridaCacheService } from './cache/corrida-cache.service';
import { validateEnv } from './config/env.validation';
import { ConsumerService } from './consumer/consumer.service';
import { CorridaEventHandler } from './consumer/corrida-event.handler';
import { HistoricoService } from './historico/historico.service';
import { OpsController } from './http/http.controllers';
import { getCorrelationId } from './observability/correlation';

/** Módulo raiz do worker. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.getOrThrow<string>('LOG_LEVEL'),
          autoLogging: false,
          // Todo log emitido durante o processamento de uma mensagem leva o correlation_id dela.
          mixin: () => {
            const correlationId = getCorrelationId();
            return correlationId ? { correlation_id: correlationId } : {};
          },
        },
      }),
    }),
    TerminusModule,
  ],
  controllers: [OpsController],
  providers: [
    CorridaCacheService,
    HistoricoService,
    CorridaEventHandler,
    ConsumerService,
  ],
})
export class AppModule {}
