import type { AnalysisSessionSummary } from '@shared/ipc-contract'
import SessionRow from './SessionRow'

export default function RecentSessions({
  sessions,
  onOpen,
  onViewAll,
  title = 'Recent Sessions',
  limit
}: {
  sessions: AnalysisSessionSummary[]
  onOpen: (session: AnalysisSessionSummary) => void
  onViewAll?: () => void
  title?: string
  limit?: number
}): JSX.Element {
  const visible = typeof limit === 'number' ? sessions.slice(0, limit) : sessions

  return (
    <section className="dashboard-recent" aria-labelledby="recent-sessions-title">
      <div className="dashboard-section-heading">
        <div>
          <h2 id="recent-sessions-title">{title}</h2>
          <p>{sessions.length} saved locally on this device</p>
        </div>
        {onViewAll ? (
          <button type="button" onClick={onViewAll}>
            View all
          </button>
        ) : null}
      </div>
      <div className="dashboard-session-list">
        {visible.map((session) => (
          <SessionRow key={session.analysis.id} session={session} onOpen={onOpen} />
        ))}
        {visible.length === 0 ? <p className="dashboard-session-empty">No saved sessions yet.</p> : null}
      </div>
    </section>
  )
}
