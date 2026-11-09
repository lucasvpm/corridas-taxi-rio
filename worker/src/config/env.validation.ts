// Necessário para o class-transformer ler os tipos (design:type) mesmo fora do Nest (ex.: testes).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsString, Min, validateSync } from 'class-validator';

/**
 * Variáveis de ambiente do worker. Defaults apontam para o docker compose em localhost
 * (credenciais de DESENVOLVIMENTO). Nomes de fila são configuráveis para os testes e2e
 * usarem filas próprias sem competir com um worker rodando.
 */
// Os tipos explícitos (: number / : string) NÃO são redundantes: o emitDecoratorMetadata só
// registra o tipo quando ele está anotado, e é esse metadado que o enableImplicitConversion usa
// para converter "3000" (string do process.env) em número. Sem a anotação, o PORT vindo do
// docker compose era rejeitado pelo @IsInt (bug pego pelo job de stack no CI).
export class EnvVars {
  @IsInt()
  @Min(1)
  PORT: number = 3001;

  @IsString()
  AMQP_URL: string = 'amqp://corridas:corridas_dev_only@localhost:5672';

  @IsString()
  REDIS_URL: string = 'redis://localhost:6379';

  @IsString()
  MONGO_URL: string = 'mongodb://localhost:27017';

  @IsString()
  MONGO_DB: string = 'corridas';

  @IsString()
  WORKER_QUEUE: string = 'worker.corridas';

  @IsString()
  WORKER_DLX: string = 'corridas.dlx';

  @IsString()
  WORKER_DLQ: string = 'worker.corridas.dlq';

  @IsInt()
  @Min(1)
  PREFETCH: number = 10;

  @IsInt()
  @Min(1)
  CACHE_TTL_SECONDS: number = 3600;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';
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
