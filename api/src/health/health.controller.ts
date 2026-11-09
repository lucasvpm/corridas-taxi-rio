import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../auth/decorators';
import { CorridaCacheService } from '../cache/corrida-cache.service';
import { EventPublisher } from '../messaging/event-publisher.service';

/**
 * Probes de saúde (usadas pelo docker compose e pelo Kubernetes).
 * - live: o processo está de pé (não checa dependências, para não reiniciar o pod à toa).
 * - ready: pode receber tráfego. MySQL e broker são obrigatórios; Redis fora = "degraded",
 *   porque a API continua funcionando lendo direto do MySQL.
 */
@Controller('health')
export class HealthController {
  /** Recebe os indicadores de saúde. */
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly cache: CorridaCacheService,
    private readonly publisher: EventPublisher,
  ) {}

  /** Liveness: responde 200 enquanto o event loop estiver vivo. */
  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: checa MySQL, RabbitMQ e Redis. */
  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('mysql', { timeout: 1500 }),
      () => {
        const broker = this.indicators.check('rabbitmq');
        return this.publisher.isConnected()
          ? broker.up()
          : broker.down('sem conexão');
      },
      async () => {
        const redis = this.indicators.check('redis');
        return (await this.cache.ping())
          ? redis.up()
          : redis.degraded('indisponível; leituras vão direto ao MySQL');
      },
    ]);
  }
}
