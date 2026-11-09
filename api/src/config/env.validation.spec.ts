import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('converte números vindos como string do process.env (docker compose/k8s)', () => {
    const env = validateEnv({
      PORT: '3000',
      DB_PORT: '3306',
      CACHE_TTL_SECONDS: '60',
    });
    expect(env.PORT).toBe(3000);
    expect(env.DB_PORT).toBe(3306);
    expect(env.CACHE_TTL_SECONDS).toBe(60);
  });

  it('usa os defaults quando a variável não existe', () => {
    expect(validateEnv({}).PORT).toBe(3000);
  });

  it('falha cedo com valor inválido', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
