import { useEffect, useRef, useState } from 'react'
import type { ScreenWatchStatus } from '@shared/ipc-contract'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Eye,
  LifeBuoy,
  MonitorCheck,
  Settings2
} from 'lucide-react'
import AnalysisResult from '../components/dashboard/AnalysisResult'
import ClaimInputCard from '../components/dashboard/ClaimInputCard'
import DashboardHeader from '../components/dashboard/DashboardHeader'
import DesktopTitleBar from '../components/dashboard/DesktopTitleBar'
import RecentSessions from '../components/dashboard/RecentSessions'
import Sidebar, { type DashboardPage } from '../components/dashboard/Sidebar'
import StatusBadge from '../components/dashboard/StatusBadge'
import {
  buildDemoSession,
  type DashboardMode,
  type DashboardSession
} from '../data/dashboardMockData'
import { tracelyApi } from '../lib/api'
import { loadDashboardSessions, saveDashboardSessions } from '../lib/dashboardSessions'

const DEMO_LOADING_MS = 700

function PageHeading({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <header className="dashboard-page-heading">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

function ScreenWatchPage(): JSX.Element {
  const [status, setStatus] = useState<ScreenWatchStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void tracelyApi.getScreenWatchStatus().then(setStatus).catch((caught) => {
      setError(caught instanceof Error ? caught.message : String(caught))
    })
    return tracelyApi.onScreenWatchStatus(setStatus)
  }, [])

  async function toggle(): Promise<void> {
    if (!status || busy) return
    setBusy(true)
    setError(null)
    try {
      setStatus(await tracelyApi.setScreenWatchEnabled(!status.enabled))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dashboard-page">
      <PageHeading
        title="Screen Watch"
        description="Choose whether Tracely checks supported writing surfaces while you work."
      />
      <section className="dashboard-feature-card">
        <span className="dashboard-feature-icon" aria-hidden="true">
          <MonitorCheck size={26} />
        </span>
        <div className="dashboard-feature-copy">
          <div className="dashboard-feature-title-row">
            <h2>Watch supported apps</h2>
            <span className={`dashboard-live-state ${status?.enabled ? 'is-on' : ''}`}>
              {status?.enabled ? 'On' : 'Off'}
            </span>
          </div>
          <p>
            Tracely reads accessible text only in the apps you allow and keeps passive Screen Watch results out of
            your saved sessions.
          </p>
          {status?.processName ? <small>Currently watching {status.processName}</small> : null}
        </div>
        <button type="button" className="dashboard-secondary-action" disabled={!status || busy} onClick={() => void toggle()}>
          {busy ? 'Updating…' : status?.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </section>
      {error ? <p className="dashboard-form-error">{error}</p> : null}
    </div>
  )
}

function SettingsLanding({ onOpenPreferences }: { onOpenPreferences: () => void }): JSX.Element {
  return (
    <div className="dashboard-page">
      <PageHeading title="Settings" description="Manage your Tracely profile, appearance, privacy, and preferences." />
      <section className="dashboard-feature-card">
        <span className="dashboard-feature-icon" aria-hidden="true">
          <Settings2 size={26} />
        </span>
        <div className="dashboard-feature-copy">
          <h2>Preferences and account</h2>
          <p>Open the full settings workspace to adjust Screen Watch, appearance, profile, and local data.</p>
        </div>
        <button type="button" className="dashboard-secondary-action" onClick={onOpenPreferences}>
          Open preferences
        </button>
      </section>
    </div>
  )
}

function HelpPage(): JSX.Element {
  return (
    <div className="dashboard-page">
      <PageHeading title="Help & Support" description="Quick guidance for getting useful, transparent results from Tracely." />
      <div className="dashboard-help-grid">
        <section className="dashboard-help-card">
          <BookOpen size={22} aria-hidden="true" />
          <h2>Checking a passage</h2>
          <p>Paste a focused passage, choose a mode, and keep dates and populations in statistical claims.</p>
        </section>
        <section className="dashboard-help-card">
          <Eye size={22} aria-hidden="true" />
          <h2>Using Screen Watch</h2>
          <p>Enable it only for supported apps where you want Tracely to identify checkable claims.</p>
        </section>
        <section className="dashboard-help-card">
          <LifeBuoy size={22} aria-hidden="true" />
          <h2>Reading results</h2>
          <p>Evidence strength measures source quality and relevance; it never guarantees that a claim is true.</p>
        </section>
      </div>
    </div>
  )
}

function SessionDetail({ session, onBack }: { session: DashboardSession; onBack: () => void }): JSX.Element {
  return (
    <article className="dashboard-page dashboard-session-detail">
      <button type="button" className="dashboard-back-button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to sessions
      </button>
      <div className="dashboard-detail-heading">
        <div>
          <span className="dashboard-detail-kicker">Saved session</span>
          <h1>{session.title}</h1>
          <time>{session.dateLabel}</time>
        </div>
        <StatusBadge status={session.status} />
      </div>
      <section className="dashboard-detail-source">
        <h2>Original passage</h2>
        <p>{session.sourceText}</p>
      </section>
      <AnalysisResult session={session} />
    </article>
  )
}

export default function DashboardView({
  firstName,
  onOpenPreferences
}: {
  firstName: string
  onOpenPreferences: () => void
}): JSX.Element {
  const [page, setPage] = useState<DashboardPage>('home')
  const [sessions, setSessions] = useState<DashboardSession[]>(loadDashboardSessions)
  const [selectedSession, setSelectedSession] = useState<DashboardSession | null>(null)
  const [detailBackPage, setDetailBackPage] = useState<'home' | 'sessions'>('home')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<DashboardMode>('evidence')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DashboardSession | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const analysisTimerRef = useRef<number | null>(null)

  useEffect(() => {
    saveDashboardSessions(sessions)
  }, [sessions])

  useEffect(
    () => () => {
      if (analysisTimerRef.current !== null) window.clearTimeout(analysisTimerRef.current)
    },
    []
  )

  function navigate(nextPage: Exclude<DashboardPage, 'session'>): void {
    setPage(nextPage)
    setSelectedSession(null)
  }

  function startNewSession(): void {
    if (analysisTimerRef.current !== null) window.clearTimeout(analysisTimerRef.current)
    analysisTimerRef.current = null
    setPage('home')
    setText('')
    setMode('evidence')
    setLoading(false)
    setError(null)
    setResult(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function checkText(): void {
    const sourceText = text.trim()
    if (!sourceText) {
      setError('Paste or type a claim before checking it.')
      textareaRef.current?.focus()
      return
    }

    if (analysisTimerRef.current !== null) window.clearTimeout(analysisTimerRef.current)
    setError(null)
    setResult(null)
    setLoading(true)
    analysisTimerRef.current = window.setTimeout(() => {
      const id = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`
      const nextSession = buildDemoSession(id, sourceText, mode)
      setSessions((current) => [nextSession, ...current.filter((session) => session.id !== id)])
      setResult(nextSession)
      setLoading(false)
      analysisTimerRef.current = null
    }, DEMO_LOADING_MS)
  }

  function openSession(session: DashboardSession, from: 'home' | 'sessions'): void {
    setSelectedSession(session)
    setDetailBackPage(from)
    setPage('session')
  }

  const sidebarPage = page === 'session' ? 'sessions' : page

  return (
    <div className="dashboard-app">
      <DesktopTitleBar />
      <div className="dashboard-frame">
        <Sidebar activePage={sidebarPage} onNavigate={navigate} />
        <main className="dashboard-main">
          {page === 'home' ? (
            <div className="dashboard-content">
              <DashboardHeader
                firstName={firstName}
                onStartNewSession={startNewSession}
                onOpenSettings={() => navigate('settings')}
                onOpenHelp={() => navigate('help')}
              />
              <ClaimInputCard
                text={text}
                mode={mode}
                loading={loading}
                error={error}
                textareaRef={textareaRef}
                onTextChange={(nextText) => {
                  setText(nextText)
                  if (error) setError(null)
                }}
                onModeChange={setMode}
                onSubmit={checkText}
              />
              {result ? <AnalysisResult session={result} /> : null}
              <RecentSessions
                sessions={sessions}
                limit={3}
                onOpen={(session) => openSession(session, 'home')}
                onViewAll={() => navigate('sessions')}
              />
            </div>
          ) : null}

          {page === 'sessions' ? (
            <div className="dashboard-page">
              <PageHeading title="Sessions" description="Review the passages and demo results saved on this device." />
              <RecentSessions
                sessions={sessions}
                title="All Sessions"
                onOpen={(session) => openSession(session, 'sessions')}
              />
            </div>
          ) : null}

          {page === 'screen-watch' ? <ScreenWatchPage /> : null}
          {page === 'settings' ? <SettingsLanding onOpenPreferences={onOpenPreferences} /> : null}
          {page === 'help' ? <HelpPage /> : null}
          {page === 'session' && selectedSession ? (
            <SessionDetail session={selectedSession} onBack={() => navigate(detailBackPage)} />
          ) : null}
        </main>
      </div>
    </div>
  )
}
