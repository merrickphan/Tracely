import { useEffect, useMemo, useRef, useState } from 'react'
import type { Claim } from '@shared/types'
import ClaimCard from '../components/ClaimCard'
import LiveEditor from '../components/LiveEditor'
import { computeClaimSpans } from '@shared/claimSpans'
import { tracelyApi } from '../lib/api'

const DEBOUNCE_MS = 1400
const MIN_CHARS_TO_CHECK = 20

type Status = 'idle' | 'pending' | 'checking' | 'error'

export default function LiveView(): JSX.Element {
  const [text, setText] = useState('')
  const [claims, setClaims] = useState<Claim[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null)

  const lastCheckedText = useRef('')
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestId = useRef(0)

  const spans = useMemo(() => computeClaimSpans(text, claims), [text, claims])

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)

    const trimmed = text.trim()
    if (trimmed.length < MIN_CHARS_TO_CHECK || trimmed === lastCheckedText.current) {
      setStatus('idle')
      return
    }

    setStatus('pending')
    debounceTimer.current = setTimeout(() => {
      void runCheck(trimmed)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  async function runCheck(snapshot: string): Promise<void> {
    const thisRequest = ++requestId.current
    setStatus('checking')
    setError(null)
    try {
      const res = await tracelyApi.detectClaims(snapshot, 'main')
      if (thisRequest !== requestId.current) return // superseded by a newer check
      lastCheckedText.current = snapshot
      setClaims(res.claims)
      setStatus('idle')
    } catch (err) {
      if (thisRequest !== requestId.current) return
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <div className="live-view">
      <div className="live-editor-header">
        <span className="muted">
          Write or paste your paper below — Tracely underlines checkable claims as you pause typing.
        </span>
        <span className={`live-status live-status-${status}`}>
          {status === 'checking' ? 'Checking…' : null}
          {status === 'pending' ? 'Waiting for pause…' : null}
          {status === 'error' ? 'Check failed' : null}
          {status === 'idle' && claims.length > 0
            ? `${claims.length} claim${claims.length === 1 ? '' : 's'} flagged`
            : null}
        </span>
      </div>

      <LiveEditor
        text={text}
        spans={spans}
        activeClaimId={activeClaimId}
        onChange={setText}
        placeholder="Start writing…"
      />

      {error ? <p className="error-text">{error}</p> : null}

      {claims.length > 0 ? (
        <section className="results-panel live-claims-panel">
          {spans.map(({ claim }) => (
            <div
              key={claim.id}
              className={claim.id === activeClaimId ? 'live-claim-highlighted' : undefined}
              onMouseEnter={() => setActiveClaimId(claim.id)}
              onMouseLeave={() => setActiveClaimId((current) => (current === claim.id ? null : current))}
            >
              <ClaimCard claim={claim} />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}
