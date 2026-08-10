import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalysisSessionSummary, ProfileInfo, ScreenWatchStatus } from '@shared/ipc-contract'
import { ArrowLeft, BookOpen, Eye, LifeBuoy, MonitorCheck } from 'lucide-react'
import ClaimCard from '../components/ClaimCard'
import ClaimInputCard from '../components/dashboard/ClaimInputCard'
import DashboardHeader from '../components/dashboard/DashboardHeader'
import type { DashboardMode } from '../components/dashboard/ModeSelector'
import RecentSessions from '../components/dashboard/RecentSessions'
import Sidebar, { type DashboardPage, type SidebarPage } from '../components/dashboard/Sidebar'
import StatusBadge from '../components/dashboard/StatusBadge'
import { tracelyApi } from '../lib/api'
import { formatSessionDate, sessionEvidenceStatus, sessionTitle } from '../lib/sessionDisplay'
import AnalyzeView from './AnalyzeView'
import SettingsView from './SettingsView'

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
          <MonitorCheck size={22} />
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

function HelpPage(): JSX.Element {
  return (
    <div className="dashboard-page">
      <PageHeading title="Help & Support" description="Quick guidance for getting transparent results from Tracely." />
      <div className="dashboard-help-grid">
        <section className="dashboard-help-card">
          <BookOpen size={20} aria-hidden="true" />
          <h2>Checking a passage</h2>
          <p>Paste a focused passage, choose a mode, and keep dates and populations in statistical claims.</p>
        </section>
        <section className="dashboard-help-card">
          <Eye size={20} aria-hidden="true" />
          <h2>Using Screen Watch</h2>
          <p>Enable it only for supported apps where you want Tracely to identify checkable claims.</p>
        </section>
        <section className="dashboard-help-card">
          <LifeBuoy size={20} aria-hidden="true" />
          <h2>Reading results</h2>
          <p>Evidence strength measures source quality and relevance; it never guarantees that a claim is true.</p>
        </section>
      </div>
    </div>
  )
}

function SessionDetail({
  session,
  loading,
  error,
  onBack,
  onUpdated
}: {
  session: AnalysisSessionSummary
  loading: boolean
  error: string | null
  onBack: () => void
  onUpdated: () => void
}): JSX.Element {
  return (
    <article className="dashboard-page dashboard-session-detail">
      <button type="button" className="dashboard-back-button" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to sessions
      </button>
      <div className="dashboard-detail-heading">
        <div>
          <span className="dashboard-detail-kicker">Saved session</span>
          <h1>{sessionTitle(session)}</h1>
          <time dateTime={session.analysis.createdAt}>{formatSessionDate(session.analysis.createdAt)}</time>
        </div>
        <StatusBadge status={sessionEvidenceStatus(session)} />
      </div>
      <section className="dashboard-detail-source">
        <h2>Original passage</h2>
        <p>{session.analysis.sourceText}</p>
      </section>
      {loading ? <p className="dashboard-page-message">Loading saved claims…</p> : null}
      {error ? <p className="dashboard-form-error">{error}</p> : null}
      {!loading && session.claims.length > 0 ? (
        <section className="dashboard-results" aria-label="Saved claims">
          {session.claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} onUpdated={onUpdated} />
          ))}
        </section>
      ) : null}
      {!loading && session.claims.length === 0 ? (
        <p className="dashboard-page-message">No checkable claims were saved for this session.</p>
      ) : null}
    </article>
  )
}

export default function DashboardView({ firstName }: { firstName: string }): JSX.Element {
  const [page, setPage] = useState<DashboardPage>('home')
  const [sessions, setSessions] = useState<AnalysisSessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<AnalysisSessionSummary | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [detailBackPage, setDetailBackPage] = useState<'home' | 'sessions'>('home')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<DashboardMode>('evidence')
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<AnalysisSessionSummary | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const refreshSessions = useCallback(async (): Promise<void> => {
    setSessionsError(null)
    try {
      const response = await tracelyApi.listAnalysisSessions()
      setSessions(response.sessions)
    } catch (caught) {
      setSessionsError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  useEffect(() => {
    if (page !== 'home') return
    void tracelyApi.getProfile().then(setProfile).catch(() => {
      // The account initial remains available when local profile storage is unavailable.
    })
  }, [page])

  function navigate(nextPage: SidebarPage): void {
    setPage(nextPage)
    setSelectedSession(null)
  }

  function startNewSession(): void {
    setPage('new-session')
    setSelectedSession(null)
  }

  function clearHomeCheck(): void {
    setText('')
    setMode('evidence')
    setCheckError(null)
    setCheckResult(null)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  async function checkText(): Promise<void> {
    const sourceText = text.trim()
    if (!sourceText) {
      setCheckError('Paste or type a claim before checking it.')
      textareaRef.current?.focus()
      return
    }

    setChecking(true)
    setCheckError(null)
    setCheckResult(null)
    try {
      const detected = await tracelyApi.detectClaims(sourceText, 'main')
      const stored = await tracelyApi.getAnalysisResult(detected.analysisId)
      setCheckResult({ analysis: stored.analysis, claims: stored.claims })
      await refreshSessions()
    } catch (caught) {
      setCheckError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setChecking(false)
    }
  }

  async function openSession(session: AnalysisSessionSummary, from: 'home' | 'sessions'): Promise<void> {
    setSelectedSession(session)
    setDetailBackPage(from)
    setSessionLoading(true)
    setSessionError(null)
    setPage('session')
    try {
      const stored = await tracelyApi.getAnalysisResult(session.analysis.id)
      setSelectedSession({ analysis: stored.analysis, claims: stored.claims })
    } catch (caught) {
      setSessionError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSessionLoading(false)
    }
  }

  const sidebarPage: SidebarPage =
    page === 'session' ? 'sessions' : page === 'new-session' ? 'home' : page
  const displayFirstName = profile?.firstName.trim() || firstName

  return (
    <div className="dashboard-app">
      <div className="dashboard-frame">
        <Sidebar activePage={sidebarPage} onNavigate={navigate} />
        <main className="dashboard-main">
          {page === 'home' ? (
            <div className="dashboard-content">
              <DashboardHeader
                firstName={displayFirstName}
                avatarUrl={profile?.avatarUrl}
                onStartNewSession={startNewSession}
                onOpenSettings={() => navigate('settings')}
                onOpenHelp={() => navigate('help')}
                onSignOut={() => void tracelyApi.signOut()}
                onCloseWindow={() => void tracelyApi.hideWindow('main')}
              />
              <ClaimInputCard
                text={text}
                mode={mode}
                loading={checking}
                error={checkError}
                textareaRef={textareaRef}
                onTextChange={(nextText) => {
                  setText(nextText)
                  if (checkError) setCheckError(null)
                }}
                onModeChange={setMode}
                onSubmit={() => void checkText()}
              />
              {checkResult ? (
                <section className="dashboard-results" aria-live="polite" aria-label="Detected claims">
                  <div className="dashboard-results-heading">
                    <div>
                      <h2>Detected claims</h2>
                      <p>
                        {checkResult.claims.length} checkable claim{checkResult.claims.length === 1 ? '' : 's'} found
                      </p>
                    </div>
                    <button type="button" onClick={clearHomeCheck}>Clear</button>
                  </div>
                  {checkResult.claims.map((claim) => (
                    <ClaimCard key={claim.id} claim={claim} autoAction={mode} onUpdated={() => void refreshSessions()} />
                  ))}
                  {checkResult.claims.length === 0 ? (
                    <p className="dashboard-page-message">No checkable claims were detected.</p>
                  ) : null}
                </section>
              ) : null}
              <RecentSessions
                sessions={sessions}
                limit={3}
                onOpen={(session) => void openSession(session, 'home')}
                onViewAll={() => navigate('sessions')}
              />
              {sessionsLoading ? <p className="dashboard-page-message">Loading recent sessions…</p> : null}
              {sessionsError ? <p className="dashboard-form-error">{sessionsError}</p> : null}
            </div>
          ) : null}

          {page === 'sessions' ? (
            <div className="dashboard-page">
              <PageHeading title="Sessions" description="Review the passages and results saved on this device." />
              <RecentSessions
                sessions={sessions}
                title="All Sessions"
                onOpen={(session) => void openSession(session, 'sessions')}
              />
              {sessionsLoading ? <p className="dashboard-page-message">Loading saved sessions…</p> : null}
              {!sessionsLoading && sessions.length === 0 ? (
                <p className="dashboard-page-message">No sessions yet. Check a passage from Home to create one.</p>
              ) : null}
              {sessionsError ? <p className="dashboard-form-error">{sessionsError}</p> : null}
            </div>
          ) : null}

          {page === 'new-session' ? (
            <AnalyzeView
              sourceTypes={['document', 'url']}
              onNavigate={() => navigate('home')}
              onAnalysisCreated={() => void refreshSessions()}
            />
          ) : null}
          {page === 'screen-watch' ? <ScreenWatchPage /> : null}
          {page === 'settings' ? <SettingsView embedded onNavigate={() => navigate('home')} /> : null}
          {page === 'help' ? <HelpPage /> : null}
          {page === 'session' && selectedSession ? (
            <SessionDetail
              session={selectedSession}
              loading={sessionLoading}
              error={sessionError}
              onBack={() => navigate(detailBackPage)}
              onUpdated={() => void refreshSessions()}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}
