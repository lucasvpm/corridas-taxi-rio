import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('converte números vindos como string do process.env (docker compose/k8s)', () => {
    const env = validateEnv({ PORT: '3001', PREFETCH: '20' });
    expect(env.PORT).toBe(3001);
    expect(env.PREFETCH).toBe(20);
  });

  it('falha cedo com valor inválido', () => {
    expect(() => validateEnv({ PREFETCH: '0' })).toThrow(/PREFETCH/);
  });
});
