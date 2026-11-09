/** Estados possíveis de uma corrida, na ordem do fluxo feliz. */
export enum CorridaStatus {
  SOLICITADA = 'SOLICITADA',
  ACEITA = 'ACEITA',
  EM_ANDAMENTO = 'EM_ANDAMENTO',
  FINALIZADA = 'FINALIZADA',
}

/**
 * Tabela de transições permitidas. Fica isolada como domínio puro para ser
 * testada sem banco e para que a regra exista em um único lugar.
 */
const TRANSICOES: Record<CorridaStatus, readonly CorridaStatus[]> = {
  [CorridaStatus.SOLICITADA]: [CorridaStatus.ACEITA],
  [CorridaStatus.ACEITA]: [CorridaStatus.EM_ANDAMENTO],
  [CorridaStatus.EM_ANDAMENTO]: [CorridaStatus.FINALIZADA],
  [CorridaStatus.FINALIZADA]: [],
};

/** Status que um motorista pode pedir via PATCH (SOLICITADA é só o estado inicial). */
export const STATUS_ALTERAVEIS = [
  CorridaStatus.ACEITA,
  CorridaStatus.EM_ANDAMENTO,
  CorridaStatus.FINALIZADA,
] as const;

/** Diz se a corrida pode ir de `atual` para `proximo`. */
export function podeTransitar(
  atual: CorridaStatus,
  proximo: CorridaStatus,
): boolean {
  return TRANSICOES[atual].includes(proximo);
}
