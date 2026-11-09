import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CorridaData } from '../messaging/envelope';

/**
 * Compare-and-set por versão, atômico no Redis (mesmo script da API).
 * Grava só se a versão do evento for MAIOR que a do cache:
 * - reentrega do mesmo evento → não muda nada (idempotente);
 * - evento antigo chegando depois de um novo → descartado (ordem).
 */
const SET_IF_NEWER_LUA = `
local atual = redis.call('GET', KEYS[1])
if atual then
  local ok, obj = pcall(cjson.decode, atual)
  if ok and obj.version and tonumber(obj.version) >= tonumber(ARGV[2]) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[3]))
return 1
`;

type RedisWithCas = Redis & {
  setIfNewer(
    key: string,
    json: string,
    version: number,
    ttl: number,
  ): Promise<number>;
};

/** Mantém o cache de status das corridas atualizado a partir dos eventos. */
@Injectable()
export class CorridaCacheService implements OnApplicationShutdown {
  private readonly redis: RedisWithCas;
  private readonly ttlSeconds: number;

  /** Cria o cliente Redis. Aqui erros sobem: sem cache atualizado a mensagem deve ser reentregue. */
  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 2,
    }) as RedisWithCas;
    this.redis.defineCommand('setIfNewer', {
      numberOfKeys: 1,
      lua: SET_IF_NEWER_LUA,
    });
    this.ttlSeconds = Number(config.getOrThrow('CACHE_TTL_SECONDS'));
  }

  /** Monta a chave da corrida (mesma convenção da API). */
  static key(id: string): string {
    return `corrida:${id}`;
  }

  /** Grava o snapshot se for mais novo; retorna true se gravou. */
  async setIfNewer(data: CorridaData): Promise<boolean> {
    // previous_status é informação do evento, não do estado atual: fica fora do cache.
    const snapshot: Partial<CorridaData> = { ...data };
    delete snapshot.previous_status;
    const written = await this.redis.setIfNewer(
      CorridaCacheService.key(data.id),
      JSON.stringify(snapshot),
      data.version,
      this.ttlSeconds,
    );
    return written === 1;
  }

  /** Lê o snapshot cacheado (usado nos testes e no diagnóstico). */
  async get(id: string): Promise<CorridaData | null> {
    const raw = await this.redis.get(CorridaCacheService.key(id));
    return raw ? (JSON.parse(raw) as CorridaData) : null;
  }

  /** Health: o Redis responde? */
  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /** Fecha a conexão no shutdown. */
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
