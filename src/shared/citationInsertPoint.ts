// Where a parenthetical in-text citation goes.
//
// Screen Watch inserted it at the end of the located claim span, which put it
// AFTER the sentence's full stop:
//
//     Babies born to smokers have low weight. (Smith, 2020)
//
// Every author-date style wants the citation inside the sentence, with the
// terminal punctuation after the closing paren:
//
//     Babies born to smokers have low weight (Smith, 2020).
//
// The offset is off by the punctuation because the span legitimately includes
// it. `splitSentences` ends a sentence *after* its terminator, `claimDetection`
// slices that span and only `.trim()`s whitespace, and `computeClaimSpans` then
// locates that exact string — so `span.start + span.length` is the index just
// past the period, and every link in that chain is individually correct.
//
// Deliberately import-free so `node --test` can run it with no build step.

export interface CitationInsertPoint {
  /** Character offset into `text` to insert at. */
  offset: number
  /** `' '` normally; `''` at offset 0 or when the preceding character is already whitespace. */
  prefix: string
  /** True when the offset moved back over the claim's own terminal punctuation. */
  movedBeforePunctuation: boolean
}

// Short and heuristic, in the same spirit as `splitSentences`' own docblock.
// Getting one wrong costs a citation placed after a full stop — the status quo
// — rather than a mangled sentence.
const ABBREVIATIONS = new Set([
  'al',
  'etc',
  'eg',
  'ie',
  'vs',
  'cf',
  'dr',
  'mr',
  'mrs',
  'ms',
  'prof',
  'fig',
  'figs',
  'no',
  'pp',
  'ed',
  'eds',
  'st',
  'jr',
  'sr',
  'approx',
  'est',
  'ca',
  'inc',
  'ltd'
])

function isTerminator(ch: string | undefined): boolean {
  return ch === '.' || ch === '!' || ch === '?'
}

/** The alphanumeric token immediately before `end`, lowercased. */
function tokenBefore(text: string, end: number): string {
  let i = end
  while (i > 0 && /[\p{L}\p{N}]/u.test(text[i - 1])) i--
  return text.slice(i, end).toLowerCase()
}

/**
 * Finds where to insert a parenthetical citation for a claim whose located span
 * ends at `claimEnd`.
 *
 * Takes `(text, claimEnd)` rather than the claim string on purpose: that is what
 * makes the whitespace-insensitive fallback locate path in `claimSpans.ts` work
 * with no special case. Its `origEnd` points into the *real* document, whose
 * trailing characters can differ from the normalized claim text, and reading the
 * document at the offset is correct either way.
 *
 * The rule is "back up over the sentence's own terminal punctuation", with four
 * refusals. Note what is NOT in it: backing up over closing quotes or brackets.
 * That looks symmetrical and is actively wrong —
 *
 *     As shown in Figure 3 (panel b)   ->  would insert INSIDE the parenthetical
 *     He said "it works."              ->  would insert INSIDE the quotation
 *
 * Both end in a closer, so the trailing terminator run is empty and refusal (1)
 * already declines, producing the conventional result. The case where a closer
 * genuinely must be stepped over — `It works".`, period outside the quote — is
 * handled with no closer logic at all, because there the run is a plain `.`.
 */
export function findCitationInsertPoint(text: string, claimEnd: number): CitationInsertPoint {
  // Spans can outlive the text they were measured against; clamp rather than
  // reading undefined off the end.
  const end = Math.max(0, Math.min(claimEnd, text.length))

  const at = (offset: number): CitationInsertPoint => ({
    offset,
    prefix: offset === 0 || /\s/.test(text[offset - 1] ?? '') ? '' : ' ',
    movedBeforePunctuation: offset !== end
  })

  let i = end
  while (i > 0 && /\s/.test(text[i - 1])) i--

  const runEnd = i
  while (i > 0 && isTerminator(text[i - 1])) i--
  const runStart = i
  const runLength = runEnd - runStart

  // (1) No terminator: a heading or bullet fragment (splitSentences' `\n+`
  //     alternative), or a sentence ending in a closer. Nothing to move.
  if (runLength === 0) return at(end)

  // (2) An ellipsis is part of the text, not a sentence terminator. Only a run
  //     of dots counts — `?!` is a real terminator and does move. The
  //     single-character `…` never reaches here at all, since it is not in
  //     `isTerminator` and so leaves an empty run for refusal (1).
  const runIsAllDots = !text.slice(runStart, runEnd).split('').some((c) => c !== '.')
  if (runIsAllDots && runLength >= 2) return at(end)

  // (3) Nothing precedes the run — the claim is punctuation only.
  if (runStart === 0) return at(end)

  // (4) A known abbreviation ("et al.", "Fig.") or a bare initial ("J."). The
  //     period belongs to the word, not to the sentence.
  if (runLength === 1 && text[runStart] === '.') {
    const token = tokenBefore(text, runStart)
    if (ABBREVIATIONS.has(token)) return at(end)
    if (token.length === 1 && /\p{Lu}/u.test(text[runStart - 1])) return at(end)
  }

  return at(runStart)
}
