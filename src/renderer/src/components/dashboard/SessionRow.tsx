import { ChevronRight, FileText } from 'lucide-react'
import type { DashboardSession } from '../../data/dashboardMockData'
import StatusBadge from './StatusBadge'

export default function SessionRow({
  session,
  onOpen
}: {
  session: DashboardSession
  onOpen: (session: DashboardSession) => void
}): JSX.Element {
  return (
    <button type="button" className="dashboard-session-row" onClick={() => onOpen(session)}>
      <span className="dashboard-session-icon" aria-hidden="true">
        <FileText size={19} strokeWidth={1.8} />
      </span>
      <span className="dashboard-session-title">{session.title}</span>
      <StatusBadge status={session.status} />
      <time>{session.dateLabel}</time>
      <ChevronRight className="dashboard-session-chevron" size={18} aria-hidden="true" />
    </button>
  )
}
