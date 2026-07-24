import type { ScoreBreakdown } from '@shared/types'

function scoreClass(score: number): string {
  if (score >= 70) return 'score-good'
  if (score >= 40) return 'score-mid'
  return 'score-low'
}

export default function ScoreBadge({
  score,
  breakdown
}: {
  score: number
  breakdown?: ScoreBreakdown | null
}): JSX.Element {
  const title = breakdown
    ? `Sources ${Math.round(breakdown.sourceCount * 100)}% · Quality ${Math.round(
        breakdown.quality * 100
      )}% · Recency ${Math.round(breakdown.recency * 100)}% · Relevance ${Math.round(
        breakdown.relevance * 100
      )}%`
    : undefined

  return (
    <span className={`score-badge ${scoreClass(score)}`} title={title}>
      Evidence Score: {score}/100
    </span>
  )
}
