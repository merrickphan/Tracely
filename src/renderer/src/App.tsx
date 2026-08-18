import { useEffect, useState } from 'react'
import type { AuthUser } from '@shared/types'
import AnalyzeView from './views/AnalyzeView'
import DocumentsView from './views/DocumentsView'
import LibraryView from './views/LibraryView'
import HomeView from './views/HomeView'
import LoginView from './views/LoginView'
import NamePromptView from './views/NamePromptView'
import SettingsView from './views/SettingsView'
import { applyTheme } from './lib/theme'
import { applyAccentColor, applyDensity, applyFontSize, trackWindowZoom } from './lib/appearance'
import { tracelyApi } from './lib/api'

export type Tab = 'home' | 'documents' | 'analyze' | 'library' | 'settings'

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

// No window-level chrome at all. The window is resizable and draggable now, but
// neither needs a control here: the card itself is the drag handle (index.css's
// `.home-canvas`/`.analyze-view`/`.settings-shell`, with every interactive
// element opting back out), and resizing is the OS edge grab against a locked
// aspect ratio. Minimize and maximize are still off — see createMainWindow.
//
// So there is nothing to draw beyond what each view already has (Home's
// close-X, Analyze's close-X, Settings' Back link), which is exactly what the
// Figma design shows and nothing else.
export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('home')
  // Which document the editor should open. Lives here rather than inside
  // AnalyzeView because the Documents page is what chooses it, and the two are
  // siblings. `null` means a new, untitled one.
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null)
  const [gate, setGate] = useState<AuthGateState>('checking')
  const [user, setUser] = useState<AuthUser | null>(null)

  // Before the settings round-trip, not after: the window opens at whatever
  // size it was last left at, and until the zoom matches that width the card
  // renders at the wrong scale. Waiting on an IPC call to fix it is a visible
  // flash of a mis-sized UI on every launch.
  useEffect(() => trackWindowZoom(), [])

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
        {tab === 'documents' ? (
          <DocumentsView
            onNavigate={setTab}
            onOpenDocument={(id) => {
              setOpenDocumentId(id)
              setTab('analyze')
            }}
          />
        ) : null}
        {tab === 'analyze' ? <AnalyzeView onNavigate={setTab} openDocumentId={openDocumentId} /> : null}
        {tab === 'library' ? <LibraryView onNavigate={setTab} /> : null}
        {tab === 'settings' ? <SettingsView onNavigate={setTab} /> : null}
      </main>
    </div>
  )
}
