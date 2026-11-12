export type Status = 'SOLICITADA' | 'ACEITA' | 'EM_ANDAMENTO' | 'FINALIZADA'

export interface Corrida {
  id: string
  passageiro_id: string
  motorista_id: string | null
  origem: string
  destino: string
  status: Status
  version: number
  created_at: string
  updated_at: string
}

/** Corrida como o motorista vê: sem dados do passageiro e com o próximo status permitido. */
export interface CorridaMotorista {
  id: string
  motorista_id: string | null
  origem: string
  destino: string
  status: Status
  version: number
  created_at: string
  updated_at: string
  proximo_status: Status | null
}

/** Painel do motorista: corridas que ele está atendendo e corridas esperando alguém aceitar. */
export interface PainelMotorista {
  em_curso: CorridaMotorista[]
  disponiveis: CorridaMotorista[]
}

/** Erro HTTP da API com o status e a mensagem devolvida. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Chamada à API via proxy /api, sempre com o token no header Authorization. */
async function apiFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = (body as { message?: string | string[] } | null)?.message
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('; ') : (msg ?? res.statusText))
  }
  return body as T
}

/** Cria corrida; a Idempotency-Key deixa repetir o envio com segurança (ex.: clique duplo, rede instável). */
export function criarCorrida(token: string, origem: string, destino: string, idempotencyKey: string) {
  return apiFetch<Corrida>(token, '/corridas', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ origem, destino }),
  })
}

/** Lista as corridas do passageiro logado. */
export function listarCorridas(token: string) {
  return apiFetch<Corrida[]>(token, '/corridas')
}

/** Corridas em curso do motorista logado e corridas disponíveis para aceitar. */
export function listarPainelMotorista(token: string) {
  return apiFetch<PainelMotorista>(token, '/motorista/corridas')
}

/** Motorista muda o status de uma corrida. */
export function alterarStatus(token: string, id: string, status: Status) {
  return apiFetch<CorridaMotorista>(token, `/corridas/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}
