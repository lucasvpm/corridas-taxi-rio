import { Controller, Get, Header } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { register } from 'prom-client';
import { CorridaCacheService } from '../cache/corrida-cache.service';
import { ConsumerService } from '../consumer/consumer.service';
import { HistoricoService } from '../historico/historico.service';

/** O worker só expõe HTTP para operação: health e métricas. */
@Controller()
export class OpsController {
  /** Recebe as dependências checadas no readiness. */
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly consumer: ConsumerService,
    private readonly cache: CorridaCacheService,
    private readonly historico: HistoricoService,
  ) {}

  /** Liveness: processo vivo. */
  @Get('health/live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: broker, Redis e Mongo acessíveis (sem eles o worker não consegue processar). */
  @Get('health/ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => {
        const i = this.indicators.check('rabbitmq');
        return this.consumer.isConnected() ? i.up() : i.down('sem conexão');
      },
      async () => {
        const i = this.indicators.check('redis');
        return (await this.cache.ping()) ? i.up() : i.down('sem resposta');
      },
      async () => {
        const i = this.indicators.check('mongodb');
        return (await this.historico.ping()) ? i.up() : i.down('sem resposta');
      },
    ]);
  }

  /** Métricas no formato do Prometheus. */
  @Get('metrics')
  @Header('Content-Type', register.contentType)
  metrics(): Promise<string> {
    return register.metrics();
  }
}
