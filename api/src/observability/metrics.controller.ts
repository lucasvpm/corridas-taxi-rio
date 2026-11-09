import { Controller, Get, Header } from '@nestjs/common';
import { register } from 'prom-client';
import { Public } from '../auth/decorators';

/** Expõe as métricas no formato texto do Prometheus. */
@Controller('metrics')
export class MetricsController {
  /** Endpoint raspado pelo Prometheus a cada scrape_interval. */
  @Public()
  @Get()
  @Header('Content-Type', register.contentType)
  async metrics(): Promise<string> {
    return register.metrics();
  }
}
