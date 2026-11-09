import { Module } from '@nestjs/common';
import { EventPublisher } from './event-publisher.service';

/** Módulo de mensageria: expõe o publisher de eventos de corrida. */
@Module({
  providers: [EventPublisher],
  exports: [EventPublisher],
})
export class MessagingModule {}
