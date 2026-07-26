import { useState } from 'react'
import AnalyzeView from './views/AnalyzeView'
import LibraryView from './views/LibraryView'
import LiveView from './views/LiveView'
import SettingsView from './views/SettingsView'

type Tab = 'live' | 'analyze' | 'library' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'library', label: 'Library' },
  { id: 'settings', label: 'Settings' }
]

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('live')

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
        {tab === 'live' ? <LiveView /> : null}
        {tab === 'analyze' ? <AnalyzeView /> : null}
        {tab === 'library' ? <LibraryView /> : null}
        {tab === 'settings' ? <SettingsView /> : null}
      </main>
    </div>
  )
}
