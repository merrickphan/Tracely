import { useEffect, useState } from 'react'
import AnalyzeView from './views/AnalyzeView'
import HomeView from './views/HomeView'
import LibraryView from './views/LibraryView'
import SettingsView from './views/SettingsView'
import WindowControls from './components/WindowControls'
import Logo from './components/Logo'
import { applyTheme } from './lib/theme'
import { applyAccentColor, applyDensity } from './lib/appearance'
import { tracelyApi } from './lib/api'

export type Tab = 'home' | 'analyze' | 'library' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('home')

  useEffect(() => {
    tracelyApi.getSettings().then((s) => {
      applyTheme(s.theme)
      applyAccentColor(s.accentColor)
      applyDensity(s.density)
    })
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <Logo size={22} />
          <h1>Tracely</h1>
        </div>
        <nav className="tab-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-button ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="app-header-spacer" />
        <WindowControls />
      </header>
      <main className={`app-main ${tab === 'home' ? 'app-main-fixed' : ''}`}>
        {tab === 'home' ? <HomeView onNavigate={setTab} /> : null}
        {tab === 'analyze' ? <AnalyzeView /> : null}
        {tab === 'library' ? <LibraryView /> : null}
        {tab === 'settings' ? <SettingsView /> : null}
      </main>
    </div>
  )
}
