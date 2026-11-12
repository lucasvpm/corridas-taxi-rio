import { CorridaStatus, podeTransitar, proximoStatus } from './corrida-status';

describe('podeTransitar', () => {
  const { SOLICITADA, ACEITA, EM_ANDAMENTO, FINALIZADA } = CorridaStatus;

  it.each([
    [SOLICITADA, ACEITA],
    [ACEITA, EM_ANDAMENTO],
    [EM_ANDAMENTO, FINALIZADA],
  ])('permite %s -> %s', (de, para) => {
    expect(podeTransitar(de, para)).toBe(true);
  });

  it.each([
    [SOLICITADA, EM_ANDAMENTO],
    [SOLICITADA, FINALIZADA],
    [ACEITA, ACEITA],
    [ACEITA, FINALIZADA],
    [EM_ANDAMENTO, ACEITA],
    [FINALIZADA, ACEITA],
    [FINALIZADA, EM_ANDAMENTO],
    [FINALIZADA, SOLICITADA],
  ])('rejeita %s -> %s', (de, para) => {
    expect(podeTransitar(de, para)).toBe(false);
  });

  it('não permite sair de FINALIZADA para nenhum estado', () => {
    const destinos = Object.values(CorridaStatus).filter((s) =>
      podeTransitar(FINALIZADA, s),
    );
    expect(destinos).toEqual([]);
  });
});

describe('proximoStatus', () => {
  const { SOLICITADA, ACEITA, EM_ANDAMENTO, FINALIZADA } = CorridaStatus;

  it.each([
    [SOLICITADA, ACEITA],
    [ACEITA, EM_ANDAMENTO],
    [EM_ANDAMENTO, FINALIZADA],
  ])('depois de %s vem %s', (atual, proximo) => {
    expect(proximoStatus(atual)).toBe(proximo);
  });

  it('não existe próximo status depois de FINALIZADA', () => {
    expect(proximoStatus(FINALIZADA)).toBeNull();
  });

  it('nunca sugere uma transição que a máquina de estados recusaria', () => {
    const sugeridas = Object.values(CorridaStatus)
      .map((s) => [s, proximoStatus(s)] as const)
      .filter(([, p]) => p !== null);
    expect(sugeridas.every(([s, p]) => podeTransitar(s, p!))).toBe(true);
  });
});
