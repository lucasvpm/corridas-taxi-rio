import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CorridaView } from '../corridas/corrida.view';

export const REDIS = Symbol('REDIS');

/**
 * Script Lua de compare-and-set por versão. Roda atômico dentro do Redis:
 * só grava se a versão recebida for MAIOR que a do cache. Isso torna a escrita idempotente
 * (reentrega da mesma versão não muda nada) e protege contra eventos fora de ordem.
 * O mesmo script existe no worker.
 */
export const SET_IF_NEWER_LUA = `
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

/** Cria o cliente Redis com fail fast: se o Redis cair, os comandos falham na hora em vez de enfileirar. */
export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  client.defineCommand('setIfNewer', {
    numberOfKeys: 1,
    lua: SET_IF_NEWER_LUA,
  });
  return client;
}

/**
 * Cache de status das corridas (cache-aside na leitura). Quem mantém o cache atualizado
 * no dia a dia é o worker, via eventos. A API só popula em caso de MISS.
 * Qualquer erro de Redis é engolido e logado: o cache é uma otimização, nunca a verdade.
 */
@Injectable()
export class CorridaCacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(CorridaCacheService.name);
  private readonly ttlSeconds: number;

  /** Recebe o cliente Redis compartilhado e o TTL configurado. */
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.ttlSeconds = Number(config.getOrThrow('CACHE_TTL_SECONDS'));
  }

  /** Monta a chave da corrida no Redis. */
  static key(id: string): string {
    return `corrida:${id}`;
  }

  /** Lê a corrida do cache; devolve null em MISS ou se o Redis estiver fora. */
  async get(id: string): Promise<CorridaView | null> {
    try {
      const raw = await this.redis.get(CorridaCacheService.key(id));
      return raw ? (JSON.parse(raw) as CorridaView) : null;
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'Redis indisponível na leitura; caindo para o MySQL',
      );
      return null;
    }
  }

  /** Grava a corrida no cache somente se for mais nova que a versão já armazenada. */
  async setIfNewer(view: CorridaView): Promise<void> {
    try {
      await (this.redis as RedisWithCas).setIfNewer(
        CorridaCacheService.key(view.id),
        JSON.stringify(view),
        view.version,
        this.ttlSeconds,
      );
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        'Falha ao popular o cache; seguindo sem cache',
      );
    }
  }

  /** Responde se o Redis está acessível (usado só para informação no health). */
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
