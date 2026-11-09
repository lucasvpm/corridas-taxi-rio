import { retryDelayMs } from './consumer.service';

describe('retryDelayMs', () => {
  it('dobra a espera a cada nova entrega', () => {
    expect([0, 1, 2, 3].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000]);
  });

  it('limita a espera a 30s', () => {
    expect(retryDelayMs(4)).toBe(30000);
    expect(retryDelayMs(20)).toBe(30000);
  });

  it('trata contagem ausente ou negativa como primeira tentativa', () => {
    expect(retryDelayMs(-1)).toBe(2000);
  });
});
