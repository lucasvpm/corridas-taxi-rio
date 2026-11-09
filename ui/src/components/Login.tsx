import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'

/** Tela de login: o usuário cola um JWT (os de teste ficam em scripts/test-keys/tokens.json). */
export function Login() {
  const { login } = useAuth()
  const [token, setToken] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  /** Tenta abrir a sessão com o token colado. */
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setErro(login(token))
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h2>Entrar com token</h2>
      <p className="muted">
        Cole um JWT de teste. Eles estão em <code>scripts/test-keys/tokens.json</code> (passageiro_1,
        motorista_1…). O token fica só na memória desta aba.
      </p>
      <label htmlFor="token">Token JWT</label>
      <textarea id="token" rows={5} value={token} onChange={(e) => setToken(e.target.value)} />
      {erro && <p className="erro">{erro}</p>}
      <button type="submit" disabled={!token.trim()}>
        Entrar
      </button>
    </form>
  )
}
