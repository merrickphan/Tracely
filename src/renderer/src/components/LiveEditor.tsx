import { useRef } from 'react'
import type { ClaimSpan } from '../lib/claimSpans'

export default function LiveEditor({
  text,
  spans,
  activeClaimId,
  onChange,
  placeholder,
  rows = 16
}: {
  text: string
  spans: ClaimSpan[]
  activeClaimId: string | null
  onChange: (text: string) => void
  placeholder?: string
  rows?: number
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  function syncScroll(): void {
    if (!textareaRef.current || !backdropRef.current) return
    backdropRef.current.scrollTop = textareaRef.current.scrollTop
    backdropRef.current.scrollLeft = textareaRef.current.scrollLeft
  }

  const segments: JSX.Element[] = []
  let cursor = 0
  spans.forEach((span, i) => {
    if (span.start > cursor) {
      segments.push(<span key={`t-${i}`}>{text.slice(cursor, span.start)}</span>)
    }
    segments.push(
      <span
        key={`c-${span.claim.id}`}
        className={`live-underline${span.claim.id === activeClaimId ? ' live-underline-active' : ''}`}
      >
        {text.slice(span.start, span.end)}
      </span>
    )
    cursor = span.end
  })
  if (cursor < text.length) {
    segments.push(<span key="t-end">{text.slice(cursor)}</span>)
  }
  // Trailing newline keeps the backdrop's last line from collapsing differently than the textarea's.
  segments.push(<span key="tail">{'\n'}</span>)

  return (
    <div className="live-editor">
      <div ref={backdropRef} className="live-editor-backdrop" aria-hidden="true">
        {segments}
      </div>
      <textarea
        ref={textareaRef}
        className="live-editor-input"
        value={text}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
      />
    </div>
  )
}
