import { useState } from 'react'
import type { Claim, EvidenceItem, ScoreBreakdown } from '@shared/types'
import { tracelyApi } from '../lib/api'
import Button from './Button'
import EvidenceCard from './EvidenceCard'
import ScoreBadge from './ScoreBadge'
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
    } finally {
      setLoadingEvidence(false)
    }
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
        <span className="claim-confidence">Confidence: {Math.round(claim.confidence * 100)}%</span>
      </div>
      <p className="claim-text">&ldquo;{claim.text}&rdquo;</p>

      <div className="claim-actions">
        <Button variant="primary" onClick={findEvidence} disabled={loadingEvidence}>
          {evidence ? 'Refresh Evidence' : 'Find Evidence'}
        </Button>
        <Button variant="secondary" onClick={critique} disabled={loadingCritique}>
          Critique Argument
        </Button>
        {claim.strengthScore !== null ? (
          <ScoreBadge score={claim.strengthScore} breakdown={claim.scoreBreakdown} />
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loadingEvidence ? <Spinner label="Searching OpenAlex, Crossref, Semantic Scholar, PubMed…" /> : null}
      {loadingCritique ? <Spinner label="Evaluating argument strength…" /> : null}

      {claim.critique ? (
        <div className="claim-critique">
          <strong>{claim.critiqueVerdict}</strong>
          <p>{claim.critique}</p>
        </div>
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
