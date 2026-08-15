import { useEffect, useState } from 'react'
import type { AuthUser } from '@shared/types'
import AnalyzeView from './views/AnalyzeView'
import LibraryView from './views/LibraryView'
import HomeView from './views/HomeView'
import LoginView from './views/LoginView'
import NamePromptView from './views/NamePromptView'
import SettingsView from './views/SettingsView'
import { applyTheme } from './lib/theme'
import { applyAccentColor, applyDensity, applyFontSize } from './lib/appearance'
import { tracelyApi } from './lib/api'

export type Tab = 'home' | 'analyze' | 'library' | 'settings'

// 'checking': initial auth lookup hasn't resolved yet. 'signedOut'/
// 'needsName' gate the whole app behind LoginView/NamePromptView. 'ready'
// is the normal signed-in (or auth-not-configured) app. A build with no
// Supabase project configured skips the gate entirely and goes straight to
// 'ready' — same fallback AuthPanel used before this gate existed.
type AuthGateState = 'checking' | 'signedOut' | 'needsName' | 'ready'

function gateFor(user: AuthUser | null, configured: boolean): AuthGateState {
  if (!configured) return 'ready'
  if (!user) return 'signedOut'
  if (!user.firstName) return 'needsName'
  return 'ready'
}

// No window-level chrome at all — the BrowserWindow itself is fixed to the
// Figma frame's own size and isn't resizable/minimizable/maximizable (see
// createMainWindow), so there's nothing here to control beyond what each
// view already draws itself (Home's close-X, Analyze's close-X, Settings'
// Back link) — exactly what the Figma design shows and nothing else.
export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('home')
  const [gate, setGate] = useState<AuthGateState>('checking')
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    tracelyApi.getSettings().then((s) => {
      applyTheme(s.theme)
      applyAccentColor(s.accentColor)
      applyDensity(s.density)
      applyFontSize(s.fontSize)
    })
  }, [])

  useEffect(() => {
    tracelyApi.getAuthUser().then((res) => {
      setUser(res.user)
      setGate(gateFor(res.user, res.configured))
    })
    // Auth-state-changed events can only ever be emitted by a real Supabase
    // client instance (see main/services/auth/client.ts), so if one fires,
    // auth is by definition configured — no need to track that flag here
    // too (and no closure-staleness risk from doing so).
    return tracelyApi.onAuthStateChanged((u) => {
      setUser(u)
      setGate(gateFor(u, true))
    })
  }, [])

  if (gate === 'checking') {
    return <div className="app-shell" />
  }

  // Both gates render inside `.app-main` like every other view. They used to be
  // direct children of `.app-shell`, which meant the window gutter `.app-main`
  // carries did not apply to them — so the login card sat flush against all
  // four window edges while every other screen was inset, which is what "the
  // login page margins are messed up" was.
  if (gate === 'signedOut') {
    return (
      <div className="app-shell">
        <main className="app-main">
          <LoginView
            onSignedIn={(u) => {
              setUser(u)
              setGate(gateFor(u, true))
            }}
          />
        </main>
      </div>
    )
  }

  if (gate === 'needsName') {
    return (
      <div className="app-shell">
        <main className="app-main">
          <NamePromptView
            onDone={(u) => {
              setUser(u)
              setGate(gateFor(u, true))
            }}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className={`app-main ${tab === 'home' ? 'app-main-fixed' : ''}`}>
        {tab === 'home' ? <HomeView onNavigate={setTab} firstName={user?.firstName ?? null} /> : null}
        {tab === 'analyze' ? <AnalyzeView onNavigate={setTab} /> : null}
        {tab === 'library' ? <LibraryView onNavigate={setTab} /> : null}
        {tab === 'settings' ? <SettingsView onNavigate={setTab} /> : null}
      </main>
    </div>
  )
}
