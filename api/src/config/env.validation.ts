// Necessário para o class-transformer ler os tipos (design:type) mesmo fora do Nest (ex.: testes).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsString, Min, validateSync } from 'class-validator';

/**
 * Variáveis de ambiente aceitas pela API. Os defaults apontam para a infra do
 * docker compose exposta em localhost, para que `npm run start:dev` funcione sem .env.
 * Todas as credenciais default são de DESENVOLVIMENTO.
 */
// Os tipos explícitos (: number / : string) NÃO são redundantes: o emitDecoratorMetadata só
// registra o tipo quando ele está anotado, e é esse metadado que o enableImplicitConversion usa
// para converter "3000" (string do process.env) em número. Sem a anotação, o PORT vindo do
// docker compose era rejeitado pelo @IsInt (bug pego pelo job de stack no CI).
export class EnvVars {
  @IsInt()
  @Min(1)
  PORT: number = 3000;

  @IsString()
  DB_HOST: string = 'localhost';

  @IsInt()
  DB_PORT: number = 3306;

  @IsString()
  DB_USER: string = 'corridas';

  @IsString()
  DB_PASSWORD: string = 'corridas_dev_only';

  @IsString()
  DB_NAME: string = 'corridas';

  @IsString()
  REDIS_URL: string = 'redis://localhost:6379';

  @IsString()
  AMQP_URL: string = 'amqp://corridas:corridas_dev_only@localhost:5672';

  @IsString()
  JWT_PUBLIC_KEY_PATH: string = '../scripts/test-keys/public.pem';

  @IsString()
  JWT_ISSUER: string = 'corridas-test-issuer';

  @IsString()
  JWT_AUDIENCE: string = 'corridas-api';

  @IsInt()
  @Min(1)
  CACHE_TTL_SECONDS: number = 3600;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';
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
