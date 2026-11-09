import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsString, Min, validateSync } from 'class-validator';

/**
 * Variáveis de ambiente do worker. Defaults apontam para o docker compose em localhost
 * (credenciais de DESENVOLVIMENTO). Nomes de fila são configuráveis para os testes e2e
 * usarem filas próprias sem competir com um worker rodando.
 */
export class EnvVars {
  @IsInt()
  @Min(1)
  PORT = 3001;

  @IsString()
  AMQP_URL = 'amqp://corridas:corridas_dev_only@localhost:5672';

  @IsString()
  REDIS_URL = 'redis://localhost:6379';

  @IsString()
  MONGO_URL = 'mongodb://localhost:27017';

  @IsString()
  MONGO_DB = 'corridas';

  @IsString()
  WORKER_QUEUE = 'worker.corridas';

  @IsString()
  WORKER_DLX = 'corridas.dlx';

  @IsString()
  WORKER_DLQ = 'worker.corridas.dlq';

  @IsInt()
  @Min(1)
  PREFETCH = 10;

  @IsInt()
  @Min(1)
  CACHE_TTL_SECONDS = 3600;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL = 'info';
}

/** Valida as variáveis na subida (fail fast). */
export function validateEnv(config: Record<string, unknown>): EnvVars {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Configuração inválida: ${errors.toString()}`);
  }
  return validated;
}
