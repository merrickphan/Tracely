import { hasRelevantSource, isRetrievalMiss } from '@shared/problemKind'
import type { CritiqueVerdict, ScoreBreakdown } from '@shared/types'

import MarkdownText from './MarkdownText'

const VERDICT_LABEL: Record<CritiqueVerdict, string> = {
  'well-supported': 'Well Supported',
  'partially-supported': 'Partially Supported',
  weak: 'Weak',
  unsupported: 'Unsupported',
  contradicted: 'Contradicted — False',
  // Named, not softened. This is the one verdict that is about the citation
  // rather than the claim, and a student who cannot tell it apart from
  // 'Unsupported' will read it as 'may still be true'.
  fabricated: 'Source Not Found — May Be Fabricated',
  // Not 'Weak'. The sentence is nearly right, and the label should say so
  // — a student who reads 'Weak' goes looking for better sources, which is
  // the one repair that cannot help an overstated quantifier.
  overstated: 'Overstated — Narrow the Claim'
}

// Reuses the same good/mid/low/danger palette ScoreBadge/claim-type chips
// already use elsewhere, so a verdict here and a score pill anywhere else in
// the app read as the same visual language rather than a one-off.
const VERDICT_CLASS: Record<CritiqueVerdict, string> = {
  'well-supported': 'evidence-verdict-good',
  'partially-supported': 'evidence-verdict-mid',
  weak: 'evidence-verdict-mid',
  unsupported: 'evidence-verdict-low',
  contradicted: 'evidence-verdict-danger',
  // Amber, not red: nothing here is false. See VERDICT_LABEL.
  fabricated: 'evidence-verdict-danger',
  overstated: 'evidence-verdict-mid'
}

// Support leads because it is the only factor that answers the question a
// reader is actually asking. The other four are proxies — a claim can score
// well on venue tier and publication year while the literature disagrees with
// it, which is how the worst-evidenced claim in eval/baseline.md ended up with
// the highest score in the run.
const BREAKDOWN_STATS: { key: keyof ScoreBreakdown; label: string }[] = [
  { key: 'support', label: 'Support' },
  { key: 'relevance', label: 'Relevance' },
  { key: 'sourceCount', label: 'Sources' },
  { key: 'quality', label: 'Quality' },
  { key: 'recency', label: 'Recency' }
]

// Replaces what used to be a single <strong>verdict</strong> + one long
// <p>critique</p> paragraph with the same "score, then structured breakdown,
// then prose" shape Grammarly-style writing tools use — the breakdown
// previously only existed as a hover-tooltip on the score pill, easy to
// never notice was there at all.
export default function EvidenceScoreCard({
  score,
  breakdown,
  verdict,
  critique,
  correction
}: {
  score: number | null
  breakdown: ScoreBreakdown | null
  verdict: CritiqueVerdict | null
  critique: string | null
  /** What the sources actually found. Present only when a local entailment
   *  model flagged a contradiction AND the relay independently confirmed it —
   *  so by the time this is non-null, two separate checks have agreed. */
  correction: string | null
}): JSX.Element {
  // "Unsupported" reached with nothing on topic retrieved is a fact about the
  // search, not about the sentence — see isRetrievalMiss. Labelled for what it
  // is, and not coloured `evidence-verdict-low`, which is a judgement.
  const retrievalMiss = isRetrievalMiss(verdict, hasRelevantSource(breakdown))
  const verdictLabel = retrievalMiss ? 'No Evidence Found' : verdict ? VERDICT_LABEL[verdict] : ''
  const verdictClass = retrievalMiss ? 'evidence-verdict-mid' : verdict ? VERDICT_CLASS[verdict] : ''

  return (
    <div className={`evidence-score-card ${verdictClass}`}>
      {verdict ? (
        <div className="evidence-score-header">
          <span className="evidence-score-verdict">{verdictLabel}</span>
          {score !== null ? (
            <span className="evidence-score-number">
              {score}
              <span className="evidence-score-number-max">/100</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {breakdown ? (
        <div className="evidence-score-breakdown">
          {BREAKDOWN_STATS.map((stat) => {
            const pct = Math.round(breakdown[stat.key] * 100)
            return (
              <div className="evidence-score-stat" key={stat.key}>
                <div className="evidence-score-stat-label">
                  <span>{stat.label}</span>
                  <span>{pct}%</span>
                </div>
                <div className="evidence-score-stat-track">
                  <div className="evidence-score-stat-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Above the critique, not inside it. The critique assesses how well the
          argument is made; this says the sentence is factually wrong and what
          the literature says instead. Someone who reads one thing on this card
          should read this one. */}
      {correction ? (
        <div className="evidence-correction">
          <div className="evidence-correction-label">What the sources actually say</div>
          <MarkdownText>{correction}</MarkdownText>
        </div>
      ) : null}

      {critique ? (
        <div className="evidence-score-critique">
          <div className="evidence-score-critique-label">Critique</div>
          <MarkdownText>{critique}</MarkdownText>
        </div>
      ) : null}
    </div>
  )
}
