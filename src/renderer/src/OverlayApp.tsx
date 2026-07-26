import { useEffect, useState } from 'react'
import type { ClaimType } from '@shared/types'
import type { ScreenWatchHoverEvent, ScreenWatchOverlayUpdateEvent, ScreenWatchWidget } from '@shared/ipc-contract'
import logo from './assets/logo.png'

const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  statistic: 'Statistic',
  causal: 'Causal claim',
  factual: 'Factual claim',
  prediction: 'Prediction',
  opinion: 'Opinion'
}

const FONT_STACK = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

export default function OverlayApp(): JSX.Element {
  const [underlines, setUnderlines] = useState<ScreenWatchOverlayUpdateEvent['underlines']>([])
  const [widget, setWidget] = useState<ScreenWatchWidget | null>(null)
  const [hover, setHover] = useState<ScreenWatchHoverEvent | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    return window.tracely.onScreenWatchOverlayUpdate((event) => {
      setUnderlines(event.underlines)
      setWidget(event.widget)
    })
  }, [])

  useEffect(() => {
    return window.tracely.onScreenWatchHover((event) => {
      setHover(event)
      setSending(false)
    })
  }, [])

  async function analyzeText(text: string): Promise<void> {
    if (!text.trim()) return
    setSending(true)
    await window.tracely.screenWatch.analyzeClaim({ text })
  }

  const widgetHovered = hover?.kind === 'widget'
  const claimHovered = hover?.kind === 'claim' ? hover : null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {underlines.flatMap((u) => {
        const isHovered = claimHovered?.claimId === u.id
        return u.rects.map((r, i) => (
          <div
            key={`${u.id}-${i}`}
            style={{
              position: 'absolute',
              left: r.x,
              top: r.y + r.height - 3,
              width: r.width,
              height: 3,
              borderRadius: 2,
              // A CSS wavy underline needs text-decoration on real text; this is a
              // free-floating rect over someone else's app, so approximate the
              // "flagged" look with a gradient bar instead, with a soft glow
              // (box-shadow blur) rather than a flat line so it actually reads
              // as "glowing" instead of just a colored bar.
              background: 'linear-gradient(90deg, #ffab3d, #ff5a36)',
              boxShadow: isHovered
                ? '0 0 10px 1px rgba(255, 90, 54, 0.9), 0 0 4px rgba(255, 171, 61, 0.95)'
                : '0 0 6px 0.5px rgba(255, 90, 54, 0.6)',
              opacity: isHovered ? 1 : 0.92,
              transition: 'box-shadow 0.12s ease, opacity 0.12s ease'
            }}
          />
        ))
      })}

      {widget ? (
        <button
          onClick={() => analyzeText(widget.text)}
          title="Analyze this in Tracely"
          style={{
            position: 'absolute',
            left: widget.rect.x,
            top: widget.rect.y,
            width: widget.rect.width,
            height: widget.rect.height,
            border: 'none',
            borderRadius: '50%',
            padding: 0,
            cursor: sending ? 'default' : 'pointer',
            background: '#17171b',
            boxShadow: widgetHovered
              ? '0 4px 14px rgba(255, 90, 54, 0.5), 0 0 0 2px #ff5a36'
              : '0 2px 8px rgba(0, 0, 0, 0.35)',
            transition: 'box-shadow 0.12s ease, transform 0.12s ease',
            transform: widgetHovered ? 'scale(1.08)' : 'scale(1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <img src={logo} alt="" style={{ width: '62%', height: '62%', borderRadius: 3, objectFit: 'contain' }} />
          {widget.claimCount > 0 ? (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                minWidth: 15,
                height: 15,
                padding: '0 3px',
                borderRadius: 999,
                background: 'linear-gradient(135deg, #ffab3d, #ff5a36)',
                color: '#fff',
                fontFamily: FONT_STACK,
                fontSize: 10,
                fontWeight: 800,
                lineHeight: '15px',
                textAlign: 'center',
                border: '2px solid #0b0b0d'
              }}
            >
              {widget.claimCount}
            </span>
          ) : null}
        </button>
      ) : null}

      {claimHovered ? (
        <div
          style={{
            position: 'absolute',
            left: Math.min(Math.max(8, claimHovered.anchor.x), window.innerWidth - 328),
            top: Math.min(claimHovered.anchor.y + claimHovered.anchor.height + 6, window.innerHeight - 140),
            maxWidth: 320,
            background: '#17171b',
            border: '1px solid #2b2b31',
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
            padding: '10px 12px',
            fontFamily: FONT_STACK,
            color: '#f6f6f8',
            // Short, linear transition smooths out the discrete 40ms position
            // updates into what reads as continuous cursor-following instead
            // of the tooltip visibly stepping/jumping between poll ticks.
            transition: 'left 0.06s linear, top 0.06s linear'
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              color: '#ffab3d',
              marginBottom: 4
            }}
          >
            {CLAIM_TYPE_LABEL[claimHovered.claimType]} flagged
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.4, marginBottom: 10 }}>
            {claimHovered.text.length > 160 ? `${claimHovered.text.slice(0, 160)}…` : claimHovered.text}
          </div>
          <button
            onClick={() => analyzeText(claimHovered.text)}
            disabled={sending}
            style={{
              border: 'none',
              borderRadius: 999,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
              cursor: sending ? 'default' : 'pointer',
              opacity: sending ? 0.6 : 1,
              background: 'linear-gradient(135deg, #ffab3d, #ff5a36)'
            }}
          >
            {sending ? 'Opening…' : 'Check in Tracely'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
