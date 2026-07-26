import type { CritiqueVerdict, ScoreBreakdown } from '@shared/types'

function scoreClass(score: number): string {
  if (score >= 70) return 'score-good'
  if (score >= 40) return 'score-mid'
  return 'score-low'
}

export default function ScoreBadge({
  score,
  breakdown,
  verdict
}: {
  score: number
  breakdown?: ScoreBreakdown | null
  verdict?: CritiqueVerdict | null
}): JSX.Element {
  const breakdownText = breakdown
    ? `Sources ${Math.round(breakdown.sourceCount * 100)}% · Quality ${Math.round(
        breakdown.quality * 100
      )}% · Recency ${Math.round(breakdown.recency * 100)}% · Relevance ${Math.round(
        breakdown.relevance * 100
      )}%`
    : undefined

  if (verdict === 'contradicted') {
    return (
      <span
        className="score-badge score-contradicted"
        title={`Fact-checked and found false. This score only measures the quality/relevance of retrieved sources, not factual accuracy. ${
          breakdownText ?? ''
        }`}
      >
        0% confidence — false
      </span>
    )
  }

  return (
    <span
      className={`score-badge ${scoreClass(score)}`}
      title={`Evidence coverage, not a truth check — run Critique to fact-check this claim. ${
        breakdownText ?? ''
      }`}
    >
      Evidence Score: {score}/100
    </span>
  )
}
