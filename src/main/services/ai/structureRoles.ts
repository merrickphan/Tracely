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
    const line = `[${i + 1}] ${truncateAtWord(text, limits.maxParagraphChars)}`
    // Stop cleanly at a whole paragraph rather than emitting a partial entry.
    // Paragraphs that do not fit are simply never labelled, and 'unknown' is
    // the correct, visible outcome for them.
    if (used + line.length + 1 > limits.maxInputChars) break
    lines.push(line)
    used += line.length + 1
  }

  return lines.join('\n')
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`
}
