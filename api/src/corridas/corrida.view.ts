import { Corrida } from './corrida.entity';
import { CorridaStatus } from './corrida-status';

/**
 * Representação pública de uma corrida. É o mesmo formato usado na resposta HTTP,
 * no cache do Redis e no campo `data` dos eventos, para que API e worker falem a mesma língua.
 * Não expõe colunas internas como `idempotency_key`.
 */
export interface CorridaView {
  id: string;
  passageiro_id: string;
  motorista_id: string | null;
  origem: string;
  destino: string;
  status: CorridaStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Converte a entidade do banco na representação pública. */
export function toCorridaView(corrida: Corrida): CorridaView {
  return {
    id: corrida.id,
    passageiro_id: corrida.passageiroId,
    motorista_id: corrida.motoristaId,
    origem: corrida.origem,
    destino: corrida.destino,
    status: corrida.status,
    version: corrida.version,
    created_at: corrida.createdAt.toISOString(),
    updated_at: corrida.updatedAt.toISOString(),
  };
}
