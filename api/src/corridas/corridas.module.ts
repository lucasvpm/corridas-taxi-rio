import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '../cache/cache.module';
import { MessagingModule } from '../messaging/messaging.module';
import { Corrida } from './corrida.entity';
import { CorridasController } from './corridas.controller';
import { CorridasService } from './corridas.service';

/** Módulo de corridas: entidade, regras de negócio e endpoints. */
@Module({
  imports: [TypeOrmModule.forFeature([Corrida]), CacheModule, MessagingModule],
  controllers: [CorridasController],
  providers: [CorridasService],
})
export class CorridasModule {}
