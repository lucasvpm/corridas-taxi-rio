import { useCallback, useEffect, useState } from 'react'
import { ApiError, alterarStatus, listarPainelMotorista } from '../api'
import type { CorridaMotorista, PainelMotorista, Status } from '../api'
import { useAuth } from '../auth/AuthContext'

const POLLING_MS = 2000

/** Texto do botão para cada status que o motorista pode pedir. */
const ACAO: Partial<Record<Status, string>> = {
  ACEITA: 'Aceitar',
  EM_ANDAMENTO: 'Iniciar',
  FINALIZADA: 'Finalizar',
}

interface ListaProps {
  corridas: CorridaMotorista[]
  vazio: string
  ocupado: boolean
  onAvancar: (corrida: CorridaMotorista) => void
}

/** Tabela de corridas com o botão da próxima ação (vinda da API em `proximo_status`). */
function ListaCorridas({ corridas, vazio, ocupado, onAvancar }: ListaProps) {
  if (corridas.length === 0) return <p className="muted">{vazio}</p>
  return (
    <div className="tabela">
      <table>
        <thead>
          <tr>
            <th>Trajeto</th>
            <th>Status</th>
            <th>Pedida às</th>
            <th>Ação</th>
          </tr>
        </thead>
        <tbody>
          {corridas.map((c) => (
            <tr key={c.id}>
              <td>
                {c.origem} → {c.destino}
              </td>
              <td>
                <span className={`status status-${c.status}`}>{c.status}</span>
              </td>
              <td>{new Date(c.created_at).toLocaleTimeString('pt-BR')}</td>
              <td>
                {c.proximo_status && (
                  <button type="button" disabled={ocupado} onClick={() => onAvancar(c)}>
                    {ACAO[c.proximo_status]}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Tela do motorista: as corridas que ele está atendendo e as disponíveis para aceitar,
 * atualizadas a cada 2s. O motorista não lê a corrida completa do passageiro; a API
 * entrega só a lista mínima (ver DECISIONS.md, entrada 8).
 */
export function Motorista() {
  const { session } = useAuth()
  const token = session!.token
  const [painel, setPainel] = useState<PainelMotorista>({ em_curso: [], disponiveis: [] })
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  /** Recarrega o painel. */
  const carregar = useCallback(async () => {
    try {
      setPainel(await listarPainelMotorista(token))
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

  /** Pede o próximo status da corrida e recarrega a lista. */
  async function avancar(corrida: CorridaMotorista) {
    if (!corrida.proximo_status) return
    setErro(null)
    setAviso(null)
    setEnviando(true)
    try {
      const atualizada = await alterarStatus(token, corrida.id, corrida.proximo_status)
      setAviso(`${atualizada.origem} → ${atualizada.destino}: agora ${atualizada.status} (versão ${atualizada.version}).`)
    } catch (e) {
      // 409 ao aceitar = outro motorista chegou antes (concorrência otimista na API).
      const perdeu = e instanceof ApiError && e.status === 409 && corrida.proximo_status === 'ACEITA'
      setErro(perdeu ? 'Outro motorista aceitou esta corrida antes de você.' : (e as Error).message)
    } finally {
      setEnviando(false)
      await carregar()
    }
  }

  return (
    <>
      {(erro || aviso) && (
        <section className="card">
          {erro && <p className="erro">{erro}</p>}
          {aviso && <p className="ok">{aviso}</p>}
        </section>
      )}

      <section className="card">
        <h2>Minhas corridas em curso</h2>
        <ListaCorridas
          corridas={painel.em_curso}
          vazio="Nenhuma corrida em curso. Aceite uma das disponíveis abaixo."
          ocupado={enviando}
          onAvancar={(c) => void avancar(c)}
        />
      </section>

      <section className="card">
        <h2>Corridas disponíveis</h2>
        <p className="muted">Atualiza sozinho a cada {POLLING_MS / 1000}s. As mais recentes aparecem primeiro.</p>
        {erroLista && <p className="erro">Falha ao atualizar: {erroLista}</p>}
        <ListaCorridas
          corridas={painel.disponiveis}
          vazio="Nenhuma corrida esperando motorista."
          ocupado={enviando}
          onAvancar={(c) => void avancar(c)}
        />
      </section>
    </>
  )
}
