import type { ParagraphRole } from '@shared/types'

/**
 * Turns the relay's structure classification into a role vector the scorer can
 * use.
 *
 * `reconcileRoles` is the defensive boundary and is written to assume the
 * payload is wrong: out of range indices, duplicates, gaps, wrong types, a
 * non-array. Every one of those resolves to 'unknown' for the affected
 * paragraph rather than throwing or shifting the rest of the vector — the same
 * posture `reconstructClaim` takes in claimDetection.ts, and it matters more
 * here because a silently misaligned vector would score a real draft against
 * another draft's structure.
 *
 * This file is a leaf on purpose (type-only imports) so `npm test` can load it.
 */

const VALID_ROLES = new Set<string>([
  'thesis',
  'claim',
  'evidence',
  'reasoning',
  'significance',
  'counterargument',
  'conclusion',
  'transition',
  'unknown'
])

export interface ReconciledRoles {
  roles: ParagraphRole[]
  warranted: boolean[]
}

function allUnknown(count: number): ReconciledRoles {
  return { roles: Array<ParagraphRole>(count).fill('unknown'), warranted: Array(count).fill(false) }
}

export function reconcileRoles(raw: unknown, paragraphCount: number): ReconciledRoles {
  if (paragraphCount <= 0) return { roles: [], warranted: [] }

  const entries = (raw as { paragraphs?: unknown })?.paragraphs
  if (!Array.isArray(entries)) return allUnknown(paragraphCount)

  const result = allUnknown(paragraphCount)
  const seen = new Set<number>()

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const { index, role, hasWarrant } = entry as Record<string, unknown>

    // 1-based, matching the numbering the model was shown.
    if (typeof index !== 'number' || !Number.isInteger(index)) continue
    if (index < 1 || index > paragraphCount) continue
    // First wins. A second entry for the same paragraph is the model
    // contradicting itself, and there is no basis for preferring the later
    // answer over the earlier one.
    if (seen.has(index)) continue
    if (typeof role !== 'string' || !VALID_ROLES.has(role)) continue

    seen.add(index)
    result.roles[index - 1] = role as ParagraphRole
    // Anything non-boolean is treated as "no warrant claimed". Defaulting the
    // other way would hand out points for a field the model did not answer.
    result.warranted[index - 1] = hasWarrant === true
  }

  return result
}

/**
 * Builds the numbered paragraph text sent to the classifier.
 *
 * Per-paragraph cap FIRST, then the global cap — see the note in costGuard.ts.
 * A paragraph is truncated at a word boundary where possible so the model is
 * not handed a fragment ending mid-word, which reads as a different kind of
 * text than the student wrote.
 */
export function buildStructurePrompt(
  paragraphTexts: string[],
  limits: { maxParagraphs: number; maxParagraphChars: number; maxInputChars: number }
): string {
  const lines: string[] = []
  let used = 0

  for (const [i, text] of paragraphTexts.slice(0, limits.maxParagraphs).entries()) {
    const line = `[${i + 1}] ${windowAtWord(text, limits.maxParagraphChars)}`
    // Stop cleanly at a whole paragraph rather than emitting a partial entry.
    // Paragraphs that do not fit are simply never labelled, and 'unknown' is
    // the correct, visible outcome for them.
    if (used + line.length + 1 > limits.maxInputChars) break
    lines.push(line)
    used += line.length + 1
  }

  return lines.join('\n')
}

/**
 * The opening AND the closing of a long paragraph, with the middle elided.
 *
 * This used to be a plain head truncation, and that was the single worst bug in
 * the structural read. A paragraph's role lives at its edges: the topic
 * sentence opens it, and the thesis, the warrant and the "so what" all close
 * it. Keeping only the head meant the model was shown the setup of every
 * paragraph and the point of none.
 *
 * Measured on a real 815-word essay whose thesis is the last sentence of a
 * 1,524-character introduction. Head-only truncation cut the thesis off
 * entirely: the model labelled the introduction 'claim', called a body
 * paragraph the thesis, found no warrant in any paragraph and left the
 * conclusion unlabelled. The draft scored 18/100 against 78 from the local
 * regexes it was meant to improve on — the model was not worse at the task, it
 * was answering about text it had never been shown.
 *
 * The per-paragraph budget went from 320 to 420 to cover two ends instead of
 * one — about 100 extra tokens per analysis on the cheapest call in the app.
 * The ellipsis is load-bearing: without it the two halves read as continuous
 * prose and the model reasons about a sentence that does not exist.
 */
function windowAtWord(text: string, max: number): string {
  if (text.length <= max) return text

  // Slightly more to the head than the tail. The head has to carry the topic
  // sentence whole, while the tail only has to reach back far enough to catch
  // the closing move.
  const headMax = Math.ceil(max * 0.55)
  const tailMax = max - headMax

  const head = text.slice(0, headMax)
  const headCut = head.lastIndexOf(' ')
  const headPart = headCut > headMax * 0.6 ? head.slice(0, headCut) : head

  const tail = text.slice(-tailMax)
  // Start the tail at a word boundary, and prefer a sentence boundary when one
  // is available inside it — a closing move that begins mid-clause is harder to
  // label than one that begins at a full stop.
  const sentenceStart = tail.search(/[.!?]["'’”)\]]*\s+\S/)
  const tailPart =
    sentenceStart !== -1 && sentenceStart < tailMax * 0.5
      ? tail.slice(tail.indexOf(' ', sentenceStart) + 1)
      : tail.slice(tail.indexOf(' ') + 1)

  return `${headPart} […] ${tailPart}`
}
