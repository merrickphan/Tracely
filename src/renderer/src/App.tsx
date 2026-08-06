import { useEffect, useState } from 'react'
import AnalyzeView from './views/AnalyzeView'
import HomeView from './views/HomeView'
import SettingsView from './views/SettingsView'
import { applyTheme } from './lib/theme'
import { applyAccentColor, applyDensity, applyFontSize } from './lib/appearance'
import { tracelyApi } from './lib/api'

export type Tab = 'home' | 'analyze' | 'settings'

// No window-level chrome at all — the BrowserWindow itself is fixed to the
// Figma frame's own size and isn't resizable/minimizable/maximizable (see
// createMainWindow), so there's nothing here to control beyond what each
// view already draws itself (Home's close-X, Analyze's close-X, Settings'
// Back link) — exactly what the Figma design shows and nothing else.
export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('home')

  useEffect(() => {
    tracelyApi.getSettings().then((s) => {
      applyTheme(s.theme)
      applyAccentColor(s.accentColor)
      applyDensity(s.density)
      applyFontSize(s.fontSize)
    })
  }, [])

  return (
    <div className="app-shell">
      <main className={`app-main ${tab === 'home' ? 'app-main-fixed' : ''}`}>
        {tab === 'home' ? <HomeView onNavigate={setTab} /> : null}
        {tab === 'analyze' ? <AnalyzeView onNavigate={setTab} /> : null}
        {tab === 'settings' ? <SettingsView onNavigate={setTab} /> : null}
      </main>
    </div>
  )
}
