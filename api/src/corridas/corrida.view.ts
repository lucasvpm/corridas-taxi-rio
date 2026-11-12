import { Corrida } from './corrida.entity';
import { CorridaStatus, proximoStatus } from './corrida-status';

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

/**
 * O que o motorista vê de uma corrida: sem `passageiro_id` (ele não precisa saber quem é o
 * passageiro para aceitar) e com o próximo status permitido, para a UI não repetir a
 * máquina de estados. Usado na lista do motorista e na resposta do PATCH.
 */
export interface CorridaMotoristaView {
  id: string;
  motorista_id: string | null;
  origem: string;
  destino: string;
  status: CorridaStatus;
  version: number;
  created_at: string;
  updated_at: string;
  proximo_status: CorridaStatus | null;
}

/** Resposta de GET /motorista/corridas. */
export interface PainelMotoristaView {
  em_curso: CorridaMotoristaView[];
  disponiveis: CorridaMotoristaView[];
}

/** Reduz a representação pública ao que o motorista precisa. */
export function toCorridaMotoristaView(
  view: CorridaView,
): CorridaMotoristaView {
  return {
    id: view.id,
    motorista_id: view.motorista_id,
    origem: view.origem,
    destino: view.destino,
    status: view.status,
    version: view.version,
    created_at: view.created_at,
    updated_at: view.updated_at,
    proximo_status: proximoStatus(view.status),
  };
}
