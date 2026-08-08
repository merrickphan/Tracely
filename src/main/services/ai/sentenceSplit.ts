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
  // The closing group covers curly quotes (’ ”) as well as straight
  // ones. Word and Google Docs — Screen Watch's whole reason for existing —
  // emit curly by default, so `He said "it works."` used to end the sentence
  // at the period and orphan the closing quote onto the front of the next
  // span. Detection selects claims by sentence index, so every span after
  // the first quotation in a document was subtly wrong.
  //
  // The second alternative treats a newline as a boundary even with no
  // terminal punctuation, which is what headings, titles and bullet
  // fragments look like; without it a heading was glued onto the first
  // sentence of the paragraph below it and the pair got flagged as one claim.
  const boundary = /(?:[.!?]+["'’”)\]]*(?:\s+|$))|(?:\n+)/g
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
