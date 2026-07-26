export interface SentenceSpan {
  start: number
  end: number
  text: string
}

/**
 * Approximate sentence splitter (doesn't special-case abbreviations like
 * "Dr." or decimals like "3.14" — good enough here, since spans are only
 * used as selectable units, and every span is always a real, exact substring
 * of the source text by construction, never a generated approximation).
 */
export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []
  const boundary = /[.!?]+["')\]]*(?:\s+|$)/g
  let start = 0
  let match: RegExpExecArray | null

  while ((match = boundary.exec(text))) {
    const end = match.index + match[0].length
    const raw = text.slice(start, end)
    if (raw.trim().length > 0) {
      spans.push({ start, end, text: raw.trim() })
    }
    start = end
  }

  if (start < text.length) {
    const raw = text.slice(start)
    if (raw.trim().length > 0) {
      spans.push({ start, end: text.length, text: raw.trim() })
    }
  }

  return spans
}
