import { useState } from 'react'
import { alterarStatus } from '../api'
import type { Corrida, Status } from '../api'
import { useAuth } from '../auth/AuthContext'

const ACOES: Array<{ status: Status; label: string }> = [
  { status: 'ACEITA', label: 'Aceitar' },
  { status: 'EM_ANDAMENTO', label: 'Iniciar' },
  { status: 'FINALIZADA', label: 'Finalizar' },
]

/**
 * Tela do motorista. Pelo enunciado o motorista só altera status, então ele informa
 * o ID da corrida (copiado da tela do passageiro) e escolhe a ação.
 */
export function Motorista() {
  const { session } = useAuth()
  const [corridaId, setCorridaId] = useState('')
  const [resultado, setResultado] = useState<Corrida | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  /** Envia a mudança de status. */
  async function executar(status: Status) {
    setErro(null)
    setResultado(null)
    try {
      setResultado(await alterarStatus(session!.token, corridaId.trim(), status))
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  return (
    <section className="card">
      <h2>Alterar status da corrida</h2>
      <label htmlFor="corrida-id">ID da corrida</label>
      <input
        id="corrida-id"
        value={corridaId}
        placeholder="cole o UUID da corrida"
        onChange={(e) => setCorridaId(e.target.value)}
      />
      <div className="acoes">
        {ACOES.map((a) => (
          <button key={a.status} type="button" disabled={!corridaId.trim()} onClick={() => void executar(a.status)}>
            {a.label}
          </button>
        ))}
      </div>
      {erro && <p className="erro">{erro}</p>}
      {resultado && (
        <p className="ok">
          Corrida agora está <span className={`status status-${resultado.status}`}>{resultado.status}</span> (versão{' '}
          {resultado.version}).
        </p>
      )}
    </section>
  )
}
