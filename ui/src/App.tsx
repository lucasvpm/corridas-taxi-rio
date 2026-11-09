import { useAuth } from './auth/AuthContext'
import { Login } from './components/Login'
import { Motorista } from './components/Motorista'
import { Passageiro } from './components/Passageiro'

/** Escolhe a tela pelo papel do token. A API valida o papel de novo em cada requisição. */
export default function App() {
  const { session, logout } = useAuth()

  return (
    <main>
      <header>
        <h1>corridas · Taxi.Rio</h1>
        {session && (
          <div className="sessao">
            <span>
              {session.sub} <strong>({session.role})</strong>
            </span>
            <button type="button" className="secundario" onClick={logout}>
              Sair
            </button>
          </div>
        )}
      </header>
      {!session && <Login />}
      {session?.role === 'passageiro' && <Passageiro />}
      {session?.role === 'motorista' && <Motorista />}
    </main>
  )
}
