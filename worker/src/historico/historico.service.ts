import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Collection, MongoClient, MongoServerError } from 'mongodb';
import { EventEnvelope } from '../messaging/envelope';

/** Documento de auditoria: um por evento, com `_id = event_id`. */
export interface EventoCorridaDoc {
  _id: string;
  type: string;
  corrida_id: string;
  version: number;
  occurred_at: Date;
  received_at: Date;
  correlation_id: string | null;
  data: EventEnvelope['data'];
}

/**
 * Histórico de eventos no MongoDB (append-only).
 * Usar o event_id como `_id` transforma o índice primário do Mongo no deduplicador:
 * reentregar o mesmo evento gera erro 11000 (duplicate key), que tratamos como "já processado".
 */
@Injectable()
export class HistoricoService implements OnModuleInit, OnApplicationShutdown {
  private readonly client: MongoClient;
  private collection!: Collection<EventoCorridaDoc>;

  /** Cria o cliente Mongo (conecta no OnModuleInit). */
  constructor(private readonly config: ConfigService) {
    this.client = new MongoClient(config.getOrThrow<string>('MONGO_URL'), {
      serverSelectionTimeoutMS: 5000,
    });
  }

  /** Conecta e garante o índice de consulta por corrida. */
  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.collection = this.client
      .db(this.config.getOrThrow<string>('MONGO_DB'))
      .collection<EventoCorridaDoc>('eventos_corrida');
    await this.collection.createIndex({ corrida_id: 1, version: 1 });
  }

  /** Insere o evento; retorna false se ele já existia (mensagem duplicada). */
  async registrar(
    envelope: EventEnvelope,
    correlationId: string | null,
  ): Promise<boolean> {
    try {
      await this.collection.insertOne({
        _id: envelope.event_id,
        type: envelope.type,
        corrida_id: envelope.corrida_id,
        version: envelope.version,
        occurred_at: new Date(envelope.occurred_at),
        received_at: new Date(),
        correlation_id: correlationId,
        data: envelope.data,
      });
      return true;
    } catch (err) {
      if (err instanceof MongoServerError && err.code === 11000) return false;
      throw err;
    }
  }

  /** Lista o histórico de uma corrida (diagnóstico e testes). */
  async listar(corridaId: string): Promise<EventoCorridaDoc[]> {
    return this.collection
      .find({ corrida_id: corridaId })
      .sort({ version: 1 })
      .toArray();
  }

  /** Health: o Mongo responde ao ping? */
  async ping(): Promise<boolean> {
    try {
      await this.client.db('admin').command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  /** Fecha a conexão no shutdown. */
  async onApplicationShutdown(): Promise<void> {
    await this.client.close().catch(() => undefined);
  }
}
