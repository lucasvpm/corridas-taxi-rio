import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Role = 'passageiro' | 'motorista'

export interface Session {
  token: string
  sub: string
  role: Role
}

interface AuthContextValue {
  session: Session | null
  login: (token: string) => string | null
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Lê o payload do JWT só para exibir quem está logado e escolher a tela.
 * NÃO é verificação de segurança: quem valida a assinatura é a API.
 */
function decodePayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Guarda a sessão SOMENTE em memória (estado do React). Nada de localStorage:
 * um token salvo no navegador fica exposto a qualquer script injetado na página.
 * Recarregar a página = fazer login de novo, o que é aceitável para este desafio.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)

  /** Valida o formato do token e abre a sessão; devolve mensagem de erro ou null. */
  const login = useCallback((raw: string): string | null => {
    const token = raw.trim().replace(/^Bearer\s+/i, '')
    const payload = decodePayload(token)
    if (!payload) return 'Isso não parece um JWT (precisa ter 3 partes separadas por ponto).'
    const { sub, role, exp } = payload
    if (typeof sub !== 'string' || (role !== 'passageiro' && role !== 'motorista')) {
      return 'O token precisa ter sub e role (passageiro ou motorista).'
    }
    if (typeof exp === 'number' && exp * 1000 < Date.now()) {
      return 'Token expirado.'
    }
    setSession({ token, sub, role })
    return null
  }, [])

  /** Descarta o token da memória. */
  const logout = useCallback(() => setSession(null), [])

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Hook de acesso à sessão. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
