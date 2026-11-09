import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CacheModule } from '../cache/cache.module';
import { MessagingModule } from '../messaging/messaging.module';
import { HealthController } from './health.controller';

/** Módulo de health checks. */
@Module({
  imports: [TerminusModule, CacheModule, MessagingModule],
  controllers: [HealthController],
})
export class HealthModule {}
