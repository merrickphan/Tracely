import { useState } from 'react'
import type { Claim, EvidenceItem, ScoreBreakdown } from '@shared/types'
import { tracelyApi } from '../lib/api'
import Button from './Button'
import EvidenceCard from './EvidenceCard'
import EvidenceScoreCard from './EvidenceScoreCard'
import Spinner from './Spinner'

const CLAIM_TYPE_LABEL: Record<Claim['claimType'], string> = {
  statistic: 'Statistic',
  causal: 'Causal claim',
  factual: 'Factual claim',
  prediction: 'Prediction',
  opinion: 'Opinion'
}

export default function ClaimCard({ claim: initialClaim }: { claim: Claim }): JSX.Element {
  const [claim, setClaim] = useState(initialClaim)
  const [evidence, setEvidence] = useState<EvidenceItem[] | null>(null)
  const [loadingEvidence, setLoadingEvidence] = useState(false)
  const [loadingCritique, setLoadingCritique] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function findEvidence(): Promise<void> {
    setLoadingEvidence(true)
    setError(null)
    try {
      const res = await tracelyApi.findEvidence(claim.id)
      setEvidence(res.evidence)
      setClaim((c) => ({ ...c, strengthScore: res.strengthScore, scoreBreakdown: res.scoreBreakdown as ScoreBreakdown }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    } finally {
      setLoadingEvidence(false)
    }
    // A high evidence score only means "good sources on this topic were found" —
    // it says nothing about whether they actually back the claim's exact wording.
    // Always fact-check immediately rather than leaving that score to stand alone.
    await critique()
  }

  async function critique(): Promise<void> {
    setLoadingCritique(true)
    setError(null)
    try {
      const res = await tracelyApi.generateCritique(claim.id)
      setClaim((c) => ({ ...c, critique: res.critique, critiqueVerdict: res.verdict }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingCritique(false)
    }
  }

  return (
    <div className="claim-card">
      <div className="claim-header">
        <span className="claim-type">{CLAIM_TYPE_LABEL[claim.claimType]}</span>
        {claim.critique ? (
          claim.critiqueVerdict === 'contradicted' ? (
            <span className="claim-confidence claim-confidence-false" title="This claim was fact-checked and found to be false.">
              0% confidence — false
            </span>
          ) : (
            <span
              className="claim-confidence"
              title="How confident Tracely is that this sentence is a checkable factual claim (vs. opinion) — not whether the claim itself is true."
            >
              Detected as claim: {Math.round(claim.confidence * 100)}%
            </span>
          )
        ) : null}
      </div>
      <p className="claim-text">&ldquo;{claim.text}&rdquo;</p>

      <div className="claim-actions">
        <Button variant="primary" onClick={findEvidence} disabled={loadingEvidence}>
          {evidence ? 'Refresh Evidence' : 'Find Evidence'}
        </Button>
        <Button variant="secondary" onClick={critique} disabled={loadingCritique}>
          {claim.critique ? 'Re-check Argument' : 'Critique Argument'}
        </Button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loadingEvidence ? <Spinner label="Searching OpenAlex, Crossref, Semantic Scholar, PubMed…" /> : null}
      {loadingCritique ? <Spinner label="Fact-checking claim & evaluating argument strength…" /> : null}

      {claim.critique ? (
        <EvidenceScoreCard
          score={claim.strengthScore}
          breakdown={claim.scoreBreakdown}
          verdict={claim.critiqueVerdict}
          critique={claim.critique}
        />
      ) : null}

      {evidence && evidence.length === 0 ? (
        <p className="muted">No supporting evidence found. Consider narrowing the claim.</p>
      ) : null}

      {evidence && evidence.length > 0 ? (
        <div className="evidence-list">
          {evidence.map((item) => (
            <EvidenceCard key={item.source.id} item={item} claimId={claim.id} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
