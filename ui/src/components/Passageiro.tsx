import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { criarCorrida, listarCorridas } from '../api'
import type { Corrida } from '../api'
import { useAuth } from '../auth/AuthContext'

const POLLING_MS = 2000

/** Tela do passageiro: solicitar corrida e acompanhar o status (polling a cada 2s). */
export function Passageiro() {
  const { session } = useAuth()
  const token = session!.token
  const [origem, setOrigem] = useState('')
  const [destino, setDestino] = useState('')
  const [corridas, setCorridas] = useState<Corrida[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // A mesma chave é reaproveitada se o envio falhar e o usuário tentar de novo.
  const pendingKey = useRef<string | null>(null)

  /** Recarrega a lista de corridas. */
  const carregar = useCallback(async () => {
    try {
      setCorridas(await listarCorridas(token))
      setErroLista(null)
    } catch (e) {
      setErroLista((e as Error).message)
    }
  }, [token])

  useEffect(() => {
    void carregar()
    const id = setInterval(() => void carregar(), POLLING_MS)
    return () => clearInterval(id)
  }, [carregar])

  /**
   * Mudar o payload invalida a chave pendente: a mesma Idempotency-Key com outro
   * corpo seria recusada pela API (422).
   */
  function alterarCampo(set: (v: string) => void, valor: string) {
    pendingKey.current = null
    set(valor)
  }

  /** Solicita a corrida com Idempotency-Key. */
  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    pendingKey.current ??= crypto.randomUUID()
    try {
      await criarCorrida(token, origem, destino, pendingKey.current)
      pendingKey.current = null
      setOrigem('')
      setDestino('')
      await carregar()
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <form className="card" onSubmit={onSubmit}>
        <h2>Solicitar corrida</h2>
        <div className="row">
          <div>
            <label htmlFor="origem">Origem</label>
            <input id="origem" value={origem} maxLength={200} onChange={(e) => alterarCampo(setOrigem, e.target.value)} />
          </div>
          <div>
            <label htmlFor="destino">Destino</label>
            <input id="destino" value={destino} maxLength={200} onChange={(e) => alterarCampo(setDestino, e.target.value)} />
          </div>
        </div>
        {erro && <p className="erro">{erro}</p>}
        <button type="submit" disabled={enviando || !origem.trim() || !destino.trim()}>
          {enviando ? 'Enviando…' : 'Solicitar'}
        </button>
      </form>

      <section className="card">
        <h2>Minhas corridas</h2>
        <p className="muted">Atualiza sozinho a cada {POLLING_MS / 1000}s.</p>
        {erroLista && <p className="erro">Falha ao atualizar: {erroLista}</p>}
        {corridas.length === 0 ? (
          <p className="muted">Nenhuma corrida ainda.</p>
        ) : (
          <div className="tabela">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Trajeto</th>
                  <th>Status</th>
                  <th>Motorista</th>
                </tr>
              </thead>
              <tbody>
                {corridas.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <code>{c.id}</code>
                    </td>
                    <td>
                      {c.origem} → {c.destino}
                    </td>
                    <td>
                      <span className={`status status-${c.status}`}>{c.status}</span>
                    </td>
                    <td>{c.motorista_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
