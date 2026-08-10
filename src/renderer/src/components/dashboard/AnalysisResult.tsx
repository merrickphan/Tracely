import { CheckCircle2, FlaskConical } from 'lucide-react'
import type { DashboardSession } from '../../data/dashboardMockData'
import StatusBadge from './StatusBadge'

export default function AnalysisResult({ session }: { session: DashboardSession }): JSX.Element {
  return (
    <section className="dashboard-analysis-result" aria-live="polite" aria-labelledby="demo-result-title">
      <div className="dashboard-result-topline">
        <span className="dashboard-demo-label">
          <FlaskConical size={14} />
          Demo data
        </span>
        <StatusBadge status={session.status} />
      </div>
      <h2 id="demo-result-title">
        {session.mode === 'evidence' ? 'Evidence preview' : 'Argument critique preview'}
      </h2>
      <p className="dashboard-result-summary">{session.summary}</p>
      <div className="dashboard-result-highlights">
        {session.highlights.map((highlight) => (
          <div key={highlight}>
            <CheckCircle2 size={17} aria-hidden="true" />
            <span>{highlight}</span>
          </div>
        ))}
      </div>
      <p className="dashboard-demo-note">
        This preview is generated locally for interface demonstration and is not a real fact-check.
      </p>
    </section>
  )
}
