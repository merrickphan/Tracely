import type { Claim } from '@shared/types'

export interface ClaimSpan {
  claim: Claim
  start: number
  end: number
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Locates each claim's text within the source it was detected from, so it can
 * be underlined in place. The model is asked for verbatim substrings, but
 * still falls back to a whitespace-insensitive search since it isn't
 * guaranteed — claims that can't be located are dropped rather than
 * mis-highlighted.
 */
export function computeClaimSpans(text: string, claims: Claim[]): ClaimSpan[] {
  const spans: ClaimSpan[] = []
  const usedRanges: Array<[number, number]> = []

  for (const claim of claims) {
    const span = locate(text, claim.text, usedRanges)
    if (!span) continue
    spans.push({ claim, start: span[0], end: span[1] })
    usedRanges.push(span)
  }

  return spans.sort((a, b) => a.start - b.start)
}

function overlaps(start: number, end: number, used: Array<[number, number]>): boolean {
  return used.some(([uStart, uEnd]) => start < uEnd && end > uStart)
}

function locate(text: string, needle: string, used: Array<[number, number]>): [number, number] | null {
  if (!needle.trim()) return null

  const exact = findAllExcluding(text, needle, used)
  if (exact) return exact

  const normalizedNeedle = normalize(needle)
  const normalizedText = normalize(text)
  const idx = normalizedText.indexOf(normalizedNeedle)
  if (idx === -1) return null

  // Map the normalized-string index back to the original text's offsets by
  // walking both strings in lockstep (they differ only in collapsed whitespace).
  return mapNormalizedRange(text, idx, idx + normalizedNeedle.length, used)
}

function findAllExcluding(
  text: string,
  needle: string,
  used: Array<[number, number]>
): [number, number] | null {
  let from = 0
  while (from <= text.length) {
    const idx = text.indexOf(needle, from)
    if (idx === -1) return null
    const end = idx + needle.length
    if (!overlaps(idx, end, used)) return [idx, end]
    from = idx + 1
  }
  return null
}

function mapNormalizedRange(
  text: string,
  normStart: number,
  normEnd: number,
  used: Array<[number, number]>
): [number, number] | null {
  let normPos = 0
  let origStart = -1
  let origEnd = -1
  let prevWasSpace = true // normalize() trims leading whitespace

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const isSpace = /\s/.test(ch)
    if (isSpace && prevWasSpace) continue // collapsed away by normalize()

    if (normPos === normStart) origStart = i
    normPos++
    if (normPos === normEnd) {
      origEnd = i + 1
      break
    }
    prevWasSpace = isSpace
  }

  if (origStart === -1 || origEnd === -1) return null
  if (overlaps(origStart, origEnd, used)) return null
  return [origStart, origEnd]
}
