import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CorridaCacheService,
  createRedisClient,
  REDIS,
} from './corrida-cache.service';

/** Provê o cliente Redis e o serviço de cache de corridas. */
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createRedisClient(config.getOrThrow('REDIS_URL')),
    },
    CorridaCacheService,
  ],
  exports: [CorridaCacheService],
})
export class CacheModule {}
