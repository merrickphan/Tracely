import { useEffect, useState } from 'react'
import type { ClaimType } from '@shared/types'
import type { ScreenWatchHoverEvent, ScreenWatchOverlayUpdateEvent } from '@shared/ipc-contract'

const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  statistic: 'Statistic',
  causal: 'Causal claim',
  factual: 'Factual claim',
  prediction: 'Prediction',
  opinion: 'Opinion'
}

export default function OverlayApp(): JSX.Element {
  const [underlines, setUnderlines] = useState<ScreenWatchOverlayUpdateEvent['underlines']>([])
  const [hover, setHover] = useState<ScreenWatchHoverEvent | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    return window.tracely.onScreenWatchOverlayUpdate((event) => {
      setUnderlines(event.underlines)
    })
  }, [])

  useEffect(() => {
    return window.tracely.onScreenWatchHover((event) => {
      setHover(event)
      setSending(false)
    })
  }, [])

  async function checkInTracely(): Promise<void> {
    if (!hover) return
    setSending(true)
    await window.tracely.screenWatch.analyzeClaim({ text: hover.text })
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {underlines.flatMap((u) =>
        u.rects.map((r, i) => (
          <div
            key={`${u.id}-${i}`}
            style={{
              position: 'absolute',
              left: r.x,
              top: r.y + r.height - 3,
              width: r.width,
              height: 3,
              borderBottom: `3px solid ${hover?.claimId === u.id ? '#ef5b3d' : '#f0a233'}`,
              // A CSS wavy underline needs text-decoration on real text; this is a
              // free-floating rect over someone else's app, so approximate the
              // "flagged" look with a solid amber bar instead.
              opacity: hover?.claimId === u.id ? 1 : 0.85,
              transition: 'border-color 0.1s ease, opacity 0.1s ease'
            }}
          />
        ))
      )}

      {hover ? (
        <div
          style={{
            position: 'absolute',
            left: Math.max(8, hover.anchor.x),
            top: hover.anchor.y + hover.anchor.height + 6,
            maxWidth: 320,
            background: '#fffaf3',
            border: '1px solid #f0e2ce',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(36, 20, 10, 0.22)',
            padding: '10px 12px',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            color: '#241f1a'
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              color: '#ef5b3d',
              marginBottom: 4
            }}
          >
            {CLAIM_TYPE_LABEL[hover.claimType]} flagged
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.4, marginBottom: 10 }}>
            {hover.text.length > 160 ? `${hover.text.slice(0, 160)}…` : hover.text}
          </div>
          <button
            onClick={checkInTracely}
            disabled={sending}
            style={{
              border: 'none',
              borderRadius: 999,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: '#fff',
              cursor: sending ? 'default' : 'pointer',
              opacity: sending ? 0.6 : 1,
              background: 'linear-gradient(135deg, #f7a440, #ef5b3d)'
            }}
          >
            {sending ? 'Opening…' : 'Check in Tracely'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
