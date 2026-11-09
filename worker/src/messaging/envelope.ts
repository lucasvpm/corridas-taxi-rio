/** Tipos de evento que o worker sabe processar. */
export const EVENT_TYPES = [
  'corrida.criada',
  'corrida.status_alterado',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Snapshot da corrida enviado no evento (mesmo formato do cache da API). */
export interface CorridaData {
  id: string;
  passageiro_id: string;
  motorista_id: string | null;
  origem: string;
  destino: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  previous_status?: string;
}

/** Envelope publicado pela API. */
export interface EventEnvelope {
  event_id: string;
  type: EventType;
  occurred_at: string;
  corrida_id: string;
  version: number;
  data: CorridaData;
}

/** Erro de mensagem malformada: não adianta reprocessar, vai direto para a DLQ. */
export class InvalidMessageError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Faz o parse e valida o envelope; lança InvalidMessageError se algo estiver fora do contrato. */
export function parseEnvelope(content: Buffer): EventEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf8'));
  } catch {
    throw new InvalidMessageError('JSON inválido');
  }
  const e = raw as Partial<EventEnvelope> | null;
  if (!e || typeof e !== 'object')
    throw new InvalidMessageError('envelope ausente');
  if (typeof e.event_id !== 'string' || !UUID.test(e.event_id)) {
    throw new InvalidMessageError('event_id inválido');
  }
  if (!EVENT_TYPES.includes(e.type as EventType)) {
    throw new InvalidMessageError(`type desconhecido: ${String(e.type)}`);
  }
  if (typeof e.corrida_id !== 'string' || !UUID.test(e.corrida_id)) {
    throw new InvalidMessageError('corrida_id inválido');
  }
  if (!Number.isInteger(e.version) || (e.version as number) < 1) {
    throw new InvalidMessageError('version inválida');
  }
  if (
    typeof e.occurred_at !== 'string' ||
    Number.isNaN(Date.parse(e.occurred_at))
  ) {
    throw new InvalidMessageError('occurred_at inválido');
  }
  const d = e.data;
  if (
    !d ||
    typeof d !== 'object' ||
    d.id !== e.corrida_id ||
    d.version !== e.version
  ) {
    throw new InvalidMessageError('data inconsistente com o envelope');
  }
  if (typeof d.passageiro_id !== 'string' || typeof d.status !== 'string') {
    throw new InvalidMessageError('data incompleto');
  }
  return e as EventEnvelope;
}
