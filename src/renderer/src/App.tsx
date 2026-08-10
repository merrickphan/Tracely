import { useEffect, useState } from 'react'
import type { AuthUser } from '@shared/types'
import DashboardView from './views/DashboardView'
import LoginView from './views/LoginView'
import NamePromptView from './views/NamePromptView'
import { applyTheme } from './lib/theme'
import { applyAccentColor, applyDensity, applyFontSize } from './lib/appearance'
import { tracelyApi } from './lib/api'

export type Tab = 'home' | 'analyze' | 'settings'

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

// Authentication still gates the renderer exactly as before. Once ready, the
// main BrowserWindow uses the dashboard shell; the established settings
// workspace stays available from that shell rather than being duplicated.
export default function App(): JSX.Element {
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

  if (gate === 'signedOut') {
    return (
      <div className="app-shell">
        <LoginView
          onSignedIn={(u) => {
            setUser(u)
            setGate(gateFor(u, true))
          }}
        />
      </div>
    )
  }

  if (gate === 'needsName') {
    return (
      <div className="app-shell">
        <NamePromptView
          onDone={(u) => {
            setUser(u)
            setGate(gateFor(u, true))
          }}
        />
      </div>
    )
  }

  return <DashboardView firstName={user?.firstName?.trim() || 'there'} />
}
