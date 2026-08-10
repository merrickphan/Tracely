import type { SessionEvidenceStatus } from '../../lib/sessionDisplay'

const STATUS_LABELS: Record<SessionEvidenceStatus, string> = {
  supported: 'Supported',
  mixed: 'Mixed evidence',
  review: 'Needs review'
}

export default function StatusBadge({ status }: { status: SessionEvidenceStatus }): JSX.Element {
  return <span className={`dashboard-status dashboard-status-${status}`}>{STATUS_LABELS[status]}</span>
}
