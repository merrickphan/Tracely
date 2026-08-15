import type { AnalysisSessionSummary } from '@shared/ipc-contract'

export type SessionEvidenceStatus = 'supported' | 'mixed' | 'review'

export function sessionTitle(session: AnalysisSessionSummary): string {
  const text = (session.claims[0]?.text || session.analysis.sourceText).trim().replace(/\s+/g, ' ')
  if (!text) return 'Untitled session'
  return text.length > 72 ? `${text.slice(0, 69).trimEnd()}…` : text
}

export function sessionEvidenceStatus(session: AnalysisSessionSummary): SessionEvidenceStatus {
  if (session.claims.length === 0) return 'review'

  if (
    session.claims.some((claim) =>
      claim.critiqueVerdict
        ? ['contradicted', 'weak', 'unsupported'].includes(claim.critiqueVerdict)
        : false
    )
  ) {
    return 'review'
  }

  const scores = session.claims
    .map((claim) => claim.strengthScore)
    .filter((score): score is number => score !== null)
  if (scores.length === 0) return 'review'

  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length
  return average >= 70 ? 'supported' : 'mixed'
}

export function formatSessionDate(iso: string, now = new Date()): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return 'Date unavailable'

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfValue = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const dayDifference = Math.round((startOfToday.getTime() - startOfValue.getTime()) / 86_400_000)
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(value)

  if (dayDifference === 0) return `Today, ${time}`
  if (dayDifference === 1) return `Yesterday, ${time}`

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(value)
}
