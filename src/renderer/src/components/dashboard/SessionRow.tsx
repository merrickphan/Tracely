import { ChevronRight, FileText } from 'lucide-react'
import type { AnalysisSessionSummary } from '@shared/ipc-contract'
import { formatSessionDate, sessionEvidenceStatus, sessionTitle } from '../../lib/sessionDisplay'
import StatusBadge from './StatusBadge'

export default function SessionRow({
  session,
  onOpen
}: {
  session: AnalysisSessionSummary
  onOpen: (session: AnalysisSessionSummary) => void
}): JSX.Element {
  return (
    <button type="button" className="dashboard-session-row" onClick={() => onOpen(session)}>
      <span className="dashboard-session-icon" aria-hidden="true">
        <FileText size={19} strokeWidth={1.8} />
      </span>
      <span className="dashboard-session-title">{sessionTitle(session)}</span>
      <StatusBadge status={sessionEvidenceStatus(session)} />
      <time dateTime={session.analysis.createdAt}>{formatSessionDate(session.analysis.createdAt)}</time>
      <ChevronRight className="dashboard-session-chevron" size={18} aria-hidden="true" />
    </button>
  )
}
