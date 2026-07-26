import { useEffect, useState } from 'react'
import AnalyzeView from './views/AnalyzeView'
import LibraryView from './views/LibraryView'
import SettingsView from './views/SettingsView'
import { applyTheme } from './lib/theme'
import { tracelyApi } from './lib/api'

type Tab = 'analyze' | 'library' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('analyze')

  useEffect(() => {
    tracelyApi.getSettings().then((s) => applyTheme(s.theme))
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Tracely</h1>
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
      </header>
      <main className="app-main">
        {tab === 'analyze' ? <AnalyzeView /> : null}
        {tab === 'library' ? <LibraryView /> : null}
        {tab === 'settings' ? <SettingsView /> : null}
      </main>
    </div>
  )
}
