import { randomUUID } from 'node:crypto';
import { InvalidMessageError, parseEnvelope } from './envelope';

/** Monta um envelope válido, permitindo sobrescrever campos. */
function envelope(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    event_id: randomUUID(),
    type: 'corrida.criada',
    occurred_at: new Date().toISOString(),
    corrida_id: id,
    version: 1,
    data: {
      id,
      passageiro_id: 'p-1',
      motorista_id: null,
      origem: 'A',
      destino: 'B',
      status: 'SOLICITADA',
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

const buf = (o: unknown) => Buffer.from(JSON.stringify(o));

describe('parseEnvelope', () => {
  it('aceita um envelope válido', () => {
    const e = envelope();
    expect(parseEnvelope(buf(e))).toEqual(e);
  });

  it('rejeita JSON inválido', () => {
    expect(() => parseEnvelope(Buffer.from('{nope'))).toThrow(
      InvalidMessageError,
    );
  });

  it.each([
    ['event_id não UUID', { event_id: 'abc' }],
    ['type desconhecido', { type: 'corrida.apagada' }],
    ['version zero', { version: 0 }],
    ['occurred_at inválido', { occurred_at: 'ontem' }],
    ['data ausente', { data: null }],
  ])('rejeita %s', (_nome, overrides) => {
    expect(() => parseEnvelope(buf(envelope(overrides)))).toThrow(
      InvalidMessageError,
    );
  });

  it('rejeita data com versão diferente do envelope', () => {
    const e = envelope();
    e.data.version = 2;
    expect(() => parseEnvelope(buf(e))).toThrow(InvalidMessageError);
  });
});
