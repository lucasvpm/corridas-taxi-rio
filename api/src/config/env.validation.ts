import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsString, Min, validateSync } from 'class-validator';

/**
 * Variáveis de ambiente aceitas pela API. Os defaults apontam para a infra do
 * docker compose exposta em localhost, para que `npm run start:dev` funcione sem .env.
 * Todas as credenciais default são de DESENVOLVIMENTO.
 */
export class EnvVars {
  @IsInt()
  @Min(1)
  PORT = 3000;

  @IsString()
  DB_HOST = 'localhost';

  @IsInt()
  DB_PORT = 3306;

  @IsString()
  DB_USER = 'corridas';

  @IsString()
  DB_PASSWORD = 'corridas_dev_only';

  @IsString()
  DB_NAME = 'corridas';

  @IsString()
  REDIS_URL = 'redis://localhost:6379';

  @IsString()
  AMQP_URL = 'amqp://corridas:corridas_dev_only@localhost:5672';

  @IsString()
  JWT_PUBLIC_KEY_PATH = '../scripts/test-keys/public.pem';

  @IsString()
  JWT_ISSUER = 'corridas-test-issuer';

  @IsString()
  JWT_AUDIENCE = 'corridas-api';

  @IsInt()
  @Min(1)
  CACHE_TTL_SECONDS = 3600;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL = 'info';
}

/**
 * Valida e converte as variáveis de ambiente na subida da aplicação.
 * Falha cedo (fail fast) se algo estiver inválido, em vez de quebrar em runtime.
 */
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
