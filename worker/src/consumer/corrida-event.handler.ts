import { Injectable } from '@nestjs/common';
import { CorridaCacheService } from '../cache/corrida-cache.service';
import { HistoricoService } from '../historico/historico.service';
import { EventEnvelope } from '../messaging/envelope';

export type HandleResult = 'processed' | 'duplicate';

/**
 * Regra de processamento de um evento de corrida, separada do transporte (AMQP) para ser testável.
 *
 * Entrega é at-least-once, então tudo aqui precisa ser idempotente. A ORDEM importa:
 * 1. Redis primeiro (CAS por versão — repetir não estraga nada);
 * 2. Mongo depois (insert com _id = event_id — repetir dá duplicate key).
 * Se fosse ao contrário e o processo morresse entre os dois passos, a reentrega seria vista
 * como "duplicada" pelo Mongo e o cache nunca seria atualizado.
 * O ack só acontece no consumer, depois que este método resolve.
 */
@Injectable()
export class CorridaEventHandler {
  /** Recebe cache e histórico. */
  constructor(
    private readonly cache: CorridaCacheService,
    private readonly historico: HistoricoService,
  ) {}

  /** Processa um evento e diz se ele era novo ou uma reentrega. */
  async handle(
    envelope: EventEnvelope,
    correlationId: string | null,
  ): Promise<HandleResult> {
    await this.cache.setIfNewer(envelope.data);
    const novo = await this.historico.registrar(envelope, correlationId);
    return novo ? 'processed' : 'duplicate';
  }
}
