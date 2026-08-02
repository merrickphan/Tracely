import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ClaimType } from '@shared/types'
import type { ScreenWatchHoverEvent, ScreenWatchOverlayUpdateEvent, ScreenWatchWidget } from '@shared/ipc-contract'
import logo from './assets/logo.png'

const FONT_STACK = "'Instrument Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif"

// Widget mark: the real Tracely brand artwork. An earlier plain <img> was
// reported not rendering on this window (the only `transparent: true`
// BrowserWindow in the app) — that was actually a path-resolution issue
// specific to a large, separately-emitted asset file. `logo.png` is small
// enough (<4kb) that Vite inlines it as a base64 data URI at build time, so
// there's no file path to resolve at runtime and it renders like any other
// data URI image.
function LogoBg({ size }: { size: number }): JSX.Element {
  return (
    <img
      src={logo}
      alt=""
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        userSelect: 'none',
        pointerEvents: 'none'
      }}
    />
  )
}

// Real per-category claim-type counts over the currently-flagged claims —
// NOT an evidence-quality judgment. No evidence search runs during Screen
// Watch, so Tracely has never actually checked whether any of these claims
// has, needs, or lacks a citation — labeling them "Unverified"/"Missing
// citation"/"Weak source" asserted things that were never checked, which
// was simply wrong on claims where it didn't happen to be true. This now
// only claims what's real: the claim's detected type.
type Bucket = 'statistic' | 'factual' | 'other'

function bucketFor(claimType: ClaimType): Bucket {
  if (claimType === 'statistic') return 'statistic'
  if (claimType === 'factual') return 'factual'
  return 'other'
}

const BUCKET_COLOR: Record<Bucket, string> = {
  statistic: '#ff5900',
  factual: '#ffb800',
  other: '#d93636'
}

const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  statistic: 'Statistic',
  causal: 'Causal claim',
  factual: 'Factual claim',
  prediction: 'Prediction',
  opinion: 'Opinion'
}

const CLAIM_TYPE_DESCRIPTION: Record<ClaimType, string> = {
  statistic: "This is a statistic — Tracely hasn't checked it against any source yet.",
  causal: 'This claims one thing causes another — cause-and-effect claims usually need stronger evidence than a single source.',
  factual: 'This is stated as fact — worth double-checking against a source before you rely on it.',
  prediction: "This is a prediction about the future — it can't be verified the same way a historical fact can.",
  opinion: 'This reads more like an opinion than a checkable claim — flagged in case that was unintentional.'
}

const BUCKET_ROW_LABEL: Record<Bucket, string> = {
  statistic: 'Statistics',
  factual: 'Factual claims',
  other: 'Other claims'
}

const POPOVER_WIDTH = 320
// Estimated, not measured — real height varies with description length,
// but we need a number before render to decide whether there's room below.
// Deliberately generous so it flips above rather than risking clipping.
const POPOVER_EST_HEIGHT = 190
const POPOVER_GAP = 10

function popoverPosition(anchor: { x: number; y: number; width: number; height: number }): {
  left: number
  top: number
  placeAbove: boolean
} {
  const spaceBelow = window.innerHeight - (anchor.y + anchor.height)
  const spaceAbove = anchor.y
  const placeAbove = spaceBelow < POPOVER_EST_HEIGHT + POPOVER_GAP && spaceAbove > spaceBelow

  const left = Math.min(Math.max(8, anchor.x), window.innerWidth - POPOVER_WIDTH - 8)
  const top = placeAbove
    ? Math.max(8, anchor.y - POPOVER_EST_HEIGHT - POPOVER_GAP)
    : anchor.y + anchor.height + POPOVER_GAP

  return { left, top, placeAbove }
}

export default function OverlayApp(): JSX.Element {
  const [underlines, setUnderlines] = useState<ScreenWatchOverlayUpdateEvent['underlines']>([])
  const [widget, setWidget] = useState<ScreenWatchWidget | null>(null)
  const [hover, setHover] = useState<ScreenWatchHoverEvent | null>(null)
  const [sending, setSending] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  // Driven locally at full mouse speed during a drag rather than round-
  // tripping every mousemove through main — main only needs to know the
  // final position (see onGripMouseDown). Cleared once the drag ends so the
  // next server-confirmed rect (which will already match) takes back over.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)

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

  function toggleWidgetExpanded(): void {
    if (!widget) return
    void window.tracely.screenWatch.setWidgetExpanded({ expanded: !widget.expanded })
  }

  function dismiss(claimId: string): void {
    setDismissedIds((prev) => new Set(prev).add(claimId))
  }

  function onGripMouseDown(e: ReactMouseEvent): void {
    if (!widget) return
    e.preventDefault()
    const startMouse = { x: e.clientX, y: e.clientY }
    const startRect = { x: widget.rect.x, y: widget.rect.y }
    void window.tracely.screenWatch.widgetDragStart()

    function clamp(pos: { x: number; y: number }): { x: number; y: number } {
      return {
        x: Math.min(Math.max(0, pos.x), window.innerWidth - 560),
        y: Math.min(Math.max(0, pos.y), window.innerHeight - 320)
      }
    }
    function onMove(ev: MouseEvent): void {
      setDragPos(clamp({ x: startRect.x + (ev.clientX - startMouse.x), y: startRect.y + (ev.clientY - startMouse.y) }))
    }
    function onUp(ev: MouseEvent): void {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const final = clamp({ x: startRect.x + (ev.clientX - startMouse.x), y: startRect.y + (ev.clientY - startMouse.y) })
      setDragPos(null)
      void window.tracely.screenWatch.widgetDragEnd(final)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const widgetHovered = hover?.kind === 'widget'
  const claimHovered = hover?.kind === 'claim' && !dismissedIds.has(hover.claimId) ? hover : null
  const claimHoveredPos = claimHovered ? popoverPosition(claimHovered.anchor) : null
  const popoverRef = useRef<HTMLDivElement>(null)
  const lastReportedPopoverKey = useRef<string | null>(null)

  // Reports the popover's REAL rendered rect (measured from the DOM, not
  // POPOVER_EST_HEIGHT's guess — that constant only exists to decide
  // above-vs-below placement before anything has rendered) to main so
  // hoverTracking.ts can hit-test against it directly. Runs after every
  // render (widget updates re-render this whole component too), but only
  // actually sends when the reported rect would change.
  useLayoutEffect(() => {
    if (claimHovered && claimHoveredPos && popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect()
      const key = `${claimHovered.claimId}:${rect.left}:${rect.top}:${rect.width}:${rect.height}`
      if (lastReportedPopoverKey.current === key) return
      lastReportedPopoverKey.current = key
      void window.tracely.screenWatch.setActivePopoverRect({
        claimId: claimHovered.claimId,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
      })
    } else if (!claimHovered && lastReportedPopoverKey.current !== null) {
      lastReportedPopoverKey.current = null
      void window.tracely.screenWatch.setActivePopoverRect({ claimId: null, rect: null })
    }
  })

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', fontFamily: FONT_STACK }}>
      {underlines
        .filter((u) => !dismissedIds.has(u.id))
        .flatMap((u) => {
          const isHovered = claimHovered?.claimId === u.id
          const color = BUCKET_COLOR[bucketFor(u.claimType)]
          return u.rects.map((r, i) => (
            <div
              key={`${u.id}-${i}`}
              style={{
                position: 'absolute',
                left: r.x,
                top: r.y + r.height,
                width: r.width,
                height: 2,
                borderRadius: 1,
                background: color,
                opacity: isHovered ? 1 : 0.85,
                boxShadow: isHovered ? `0 0 6px 0.5px ${color}99` : 'none',
                transition: 'opacity 0.12s ease, box-shadow 0.12s ease'
              }}
            />
          ))
        })}

      {widget && !widget.expanded ? (
        <div style={{ position: 'absolute', left: widget.rect.x, top: widget.rect.y, width: 56, height: 56 }}>
          <button
            onClick={toggleWidgetExpanded}
            title="Open Tracely widget"
            style={{
              position: 'absolute',
              inset: 0,
              border: 'none',
              borderRadius: '50%',
              padding: 0,
              cursor: 'pointer',
              background: '#000',
              boxShadow: widgetHovered ? '0 4px 14px rgba(0, 0, 0, 0.45), 0 0 0 2px #ff5900' : '0 2px 8px rgba(0, 0, 0, 0.35)',
              transition: 'box-shadow 0.12s ease, transform 0.12s ease',
              transform: widgetHovered ? 'scale(1.06)' : 'scale(1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <LogoBg size={26} />
          </button>
          {widget.claimCount > 0 ? (
            <div
              style={{
                position: 'absolute',
                left: 28.5,
                top: -8.5,
                width: 31,
                height: 31,
                borderRadius: '50%',
                background: '#ff5900',
                border: '2px solid #0b0b0d',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none'
              }}
            >
              {widget.claimCount}
            </div>
          ) : null}
        </div>
      ) : null}

      {widget && widget.expanded
        ? (() => {
            const b = widget.breakdown
            const rows: { bucket: Bucket; count: number }[] = [
              { bucket: 'statistic', count: b.statisticCount },
              { bucket: 'factual', count: b.factualCount },
              { bucket: 'other', count: b.otherCount }
            ]
            const panelPos = dragPos ?? widget.rect
            return (
              <div
                style={{
                  position: 'absolute',
                  left: panelPos.x,
                  top: panelPos.y,
                  width: 560,
                  height: 320,
                  background: '#fff',
                  border: '3px solid #000',
                  borderRadius: 32,
                  boxShadow: '0px 8px 12px rgba(0,0,0,0.18)',
                  overflow: 'hidden'
                }}
              >
                <div style={{ position: 'absolute', left: 22, top: 22, width: 40, height: 28, pointerEvents: 'none' }}>
                  <LogoBg size={28} />
                </div>
                <div
                  onMouseDown={onGripMouseDown}
                  title="Drag to move"
                  style={{
                    position: 'absolute',
                    left: 66,
                    top: 12,
                    width: 40,
                    height: 40,
                    cursor: 'grab'
                  }}
                >
                  {[0, 1, 2].flatMap((row) =>
                    [0, 1].map((col) => (
                      <div
                        key={`${row}-${col}`}
                        style={{
                          position: 'absolute',
                          left: 10 + col * 10,
                          top: 10 + row * 10,
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'rgba(0,0,0,0.35)',
                          pointerEvents: 'none'
                        }}
                      />
                    ))
                  )}
                </div>
                <button
                  onClick={toggleWidgetExpanded}
                  title="Close"
                  aria-label="Close"
                  style={{
                    position: 'absolute',
                    left: 522,
                    top: 16,
                    width: 24,
                    height: 24,
                    border: 'none',
                    background: 'rgba(0,0,0,0.06)',
                    borderRadius: '50%',
                    color: '#1c1c1c',
                    fontSize: 14,
                    lineHeight: '24px',
                    padding: 0,
                    cursor: 'pointer'
                  }}
                >
                  ×
                </button>
                <div style={{ position: 'absolute', left: 20, top: 60, width: 520, height: 1, background: 'rgba(0,0,0,0.1)' }} />
                <div style={{ position: 'absolute', left: 196, top: 78, width: 1, height: 216, background: 'rgba(0,0,0,0.1)' }} />

                <button
                  onClick={() => analyzeText(widget.text)}
                  disabled={sending}
                  title="Open full analysis in Tracely"
                  style={{
                    position: 'absolute',
                    left: 79,
                    top: 104,
                    width: 110,
                    height: 110,
                    border: 'none',
                    padding: 0,
                    cursor: sending ? 'default' : 'pointer',
                    borderRadius: '50%',
                    background: `conic-gradient(#ff5900 ${widget.avgConfidencePercent}%, rgba(0,0,0,0.08) ${widget.avgConfidencePercent}% 100%)`
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: 12,
                      width: 86,
                      height: 86,
                      borderRadius: '50%',
                      background: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 26,
                      fontWeight: 500,
                      color: '#1a1a1f'
                    }}
                  >
                    {widget.avgConfidencePercent}%
                  </div>
                </button>
                <div
                  style={{
                    position: 'absolute',
                    left: 79,
                    top: 224,
                    width: 110,
                    textAlign: 'center',
                    fontSize: 15,
                    fontWeight: 500,
                    color: '#1a1a1f'
                  }}
                >
                  Confidence
                </div>

                {rows.map((row, i) => (
                  <div key={row.bucket}>
                    <div
                      style={{
                        position: 'absolute',
                        left: 249,
                        top: 79 + i * 76,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: BUCKET_COLOR[row.bucket]
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: 276,
                        top: 70 + i * 76,
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 24,
                        fontWeight: 500,
                        color: '#ff5900'
                      }}
                    >
                      {row.count}
                    </div>
                    <div
                      style={{
                        position: 'absolute',
                        left: 314,
                        top: 76 + i * 76,
                        fontSize: 18,
                        fontWeight: 500,
                        color: '#1a1a1f'
                      }}
                    >
                      {BUCKET_ROW_LABEL[row.bucket]}
                    </div>
                    {i < 2 ? (
                      <div
                        style={{
                          position: 'absolute',
                          left: 254,
                          top: 126 + i * 76,
                          width: 320,
                          height: 1,
                          background: 'rgba(0,0,0,0.1)'
                        }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            )
          })()
        : null}

      {claimHovered
        ? (() => {
            const bucket = bucketFor(claimHovered.claimType)
            const pos = popoverPosition(claimHovered.anchor)
            return (
              <div
                ref={popoverRef}
                style={{
                  position: 'absolute',
                  left: pos.left,
                  top: pos.top,
                  width: POPOVER_WIDTH,
                  background: '#fff',
                  border: '2px solid #000',
                  borderRadius: 16,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  color: '#1c1c1c'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: BUCKET_COLOR[bucket],
                      flexShrink: 0
                    }}
                  />
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {CLAIM_TYPE_LABEL[claimHovered.claimType]} flagged
                  </div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.4, color: '#737373' }}>
                  {CLAIM_TYPE_DESCRIPTION[claimHovered.claimType]}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => analyzeText(claimHovered.text)}
                    disabled={sending}
                    style={{
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#fff',
                      cursor: sending ? 'default' : 'pointer',
                      opacity: sending ? 0.6 : 1,
                      background: '#1c1c1c'
                    }}
                  >
                    {sending ? 'Opening…' : 'Check in Tracely'}
                  </button>
                  <button
                    onClick={() => dismiss(claimHovered.claimId)}
                    style={{
                      border: '1px solid #d9d9d9',
                      borderRadius: 8,
                      padding: '8px 14px',
                      fontSize: 13,
                      fontWeight: 400,
                      color: '#1c1c1c',
                      background: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )
          })()
        : null}
    </div>
  )
}
