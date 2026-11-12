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

/** Status em que a corrida já tem motorista e ainda não terminou. */
export const STATUS_EM_CURSO = [
  CorridaStatus.ACEITA,
  CorridaStatus.EM_ANDAMENTO,
] as const;

/**
 * Próximo status do fluxo a partir de `atual` (null em FINALIZADA).
 * A API devolve esse valor para a UI do motorista montar o botão certo
 * sem repetir a máquina de estados no front.
 */
export function proximoStatus(atual: CorridaStatus): CorridaStatus | null {
  return TRANSICOES[atual][0] ?? null;
}
