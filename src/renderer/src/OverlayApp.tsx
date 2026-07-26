import { useEffect, useState } from 'react'
import type { ClaimType } from '@shared/types'
import type { ScreenWatchHoverEvent, ScreenWatchOverlayUpdateEvent, ScreenWatchWidget } from '@shared/ipc-contract'
import Logo from './components/Logo'

const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  statistic: 'Statistic',
  causal: 'Causal claim',
  factual: 'Factual claim',
  prediction: 'Prediction',
  opinion: 'Opinion'
}

const FONT_STACK = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

const TOOLTIP_WIDTH = 320
// Estimated, not measured — the tooltip's real height varies with claim
// text length, but we need a number before it's rendered to decide whether
// there's room below. Deliberately generous (most tooltips are shorter)
// so it flips above a bit more readily than strictly necessary rather than
// risk clipping against the bottom edge.
const TOOLTIP_EST_HEIGHT = 150
const TOOLTIP_GAP = 8

function tooltipPosition(anchor: { x: number; y: number; width: number; height: number }): {
  left: number
  top: number
} {
  const spaceBelow = window.innerHeight - (anchor.y + anchor.height)
  const spaceAbove = anchor.y
  const placeAbove = spaceBelow < TOOLTIP_EST_HEIGHT + TOOLTIP_GAP && spaceAbove > spaceBelow

  return {
    left: Math.min(Math.max(8, anchor.x), window.innerWidth - TOOLTIP_WIDTH - 8),
    top: placeAbove
      ? Math.max(8, anchor.y - TOOLTIP_EST_HEIGHT - TOOLTIP_GAP)
      : anchor.y + anchor.height + TOOLTIP_GAP
  }
}

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
          <Logo size={22} />
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

      {claimHovered
        ? (() => {
            const pos = tooltipPosition(claimHovered.anchor)
            return (
              <div
                style={{
                  position: 'absolute',
                  left: pos.left,
                  top: pos.top,
                  width: TOOLTIP_WIDTH,
                  background: '#17171b',
                  border: '1px solid #2b2b31',
                  borderRadius: 12,
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
                  padding: '10px 12px',
                  fontFamily: FONT_STACK,
                  color: '#f6f6f8'
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
            )
          })()
        : null}
    </div>
  )
}
