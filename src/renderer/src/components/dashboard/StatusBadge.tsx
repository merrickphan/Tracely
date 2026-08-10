import type { SessionStatus } from '../../data/dashboardMockData'

const STATUS_LABELS: Record<SessionStatus, string> = {
  supported: 'Supported',
  mixed: 'Mixed evidence',
  review: 'Needs review'
}

export default function StatusBadge({ status }: { status: SessionStatus }): JSX.Element {
  return <span className={`dashboard-status dashboard-status-${status}`}>{STATUS_LABELS[status]}</span>
}
