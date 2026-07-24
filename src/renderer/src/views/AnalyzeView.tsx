import { useState } from 'react'
import type { Claim } from '@shared/types'
import ClaimCard from '../components/ClaimCard'
import Button from '../components/Button'
import Spinner from '../components/Spinner'
import TextArea from '../components/TextArea'
import { folioApi } from '../lib/api'

export default function AnalyzeView(): JSX.Element {
  const [text, setText] = useState('')
  const [claims, setClaims] = useState<Claim[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function analyze(): Promise<void> {
    if (!text.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await folioApi.detectClaims(text, 'main')
      setClaims(res.claims)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="analyze-view">
      <section className="analyze-input">
        <TextArea
          placeholder="Paste a paragraph, essay, or argument to check its credibility…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
        />
        <div className="analyze-input-actions">
          <Button variant="primary" onClick={analyze} disabled={loading || !text.trim()}>
            Analyze
          </Button>
          {claims ? (
            <span className="muted">
              {claims.length} claim{claims.length === 1 ? '' : 's'} detected
            </span>
          ) : null}
        </div>
      </section>

      {loading ? <Spinner label="Detecting claims…" /> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {claims && claims.length === 0 ? (
        <p className="muted">No checkable claims detected in this text.</p>
      ) : null}

      {claims ? (
        <section className="results-panel">
          {claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
