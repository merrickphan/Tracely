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
  /**
   * Does this paragraph assert a contestable sub-point of its own?
   *
   * A separate axis from `role`, for the same reason `warranted` is one: the
   * role is the ONE thing a paragraph is primarily for, and "is this paragraph
   * governed by a claim" is a different question that a paragraph can answer
   * yes to whatever its dominant role turns out to be.
   *
   * They were the same field until 2026-08-18, and the collapse cost real
   * essays 20 points. A body paragraph that opens with a sub-point and then
   * cites three studies for it is *primarily* presenting evidence — the model
   * labels it `evidence`, correctly, and the local heuristics reach their
   * evidence branch for it too — while `governingClaims` counted only
   * `role === 'claim'`. So the better-supported the paragraph was, the more
   * certainly it scored zero on the component asking whether it had a point.
   * Measured on the Hepburn draft: both body paragraphs came back `evidence`
   * and governingClaims scored 0/20 on an essay whose body paragraphs each
   * open with an explicit evaluative claim.
   */
  statesClaim: boolean[]
  /**
   * The NAME of the reasoning fault in each paragraph, or 'none'.
   *
   * `warranted` asks whether a paragraph explains its link and answers in one
   * bit. The model is making a far richer judgement than that to decide it —
   * the prompt asks it to distinguish summary, a logical leap, sequence read as
   * cause, and a generalisation from a single case — and every one of those
   * distinctions was being discarded on the way back.
   *
   * The cost was the whole quality of the report. A paragraph that treats a
   * correlation as a cause and one that simply stops after a quotation both
   * arrived as `warranted: false` and produced the identical sentence:
   * "presents evidence without explaining how it supports the argument." The
   * rubric calls ANALYSIS / REASONING one of the most important grading
   * dimensions, and the channel between the model's reading and the writer's
   * screen was one bit wide.
   *
   * 'none' is the common and correct answer, including for many paragraphs
   * where `warranted` is false: a paragraph that presents a statistic and stops
   * has no reasoning to be faulty, it has none at all.
   */
  reasoningFailure: ReasoningFailure[]
}

/**
 * The four reasoning faults the classifier can name.
 *
 * Each is a rubric clause under ANALYSIS / REASONING, and `shared/rubric.ts`
 * ties each resulting weakness back to the exact sentence it comes from. There
 * is no 'summary' member on purpose: `summary-without-point` already catches
 * that locally and for free, from the structure of the paragraph rather than
 * from a model's opinion of it.
 */
export type ReasoningFailure = 'none' | 'circular' | 'sequence-as-cause' | 'single-case' | 'leap'

const VALID_FAILURES = new Set<string>(['none', 'circular', 'sequence-as-cause', 'single-case', 'leap'])

function allUnknown(count: number): ReconciledRoles {
  return {
    roles: Array<ParagraphRole>(count).fill('unknown'),
    warranted: Array(count).fill(false),
    statesClaim: Array(count).fill(false),
    reasoningFailure: Array<ReasoningFailure>(count).fill('none')
  }
}

export function reconcileRoles(raw: unknown, paragraphCount: number): ReconciledRoles {
  if (paragraphCount <= 0) return { roles: [], warranted: [], statesClaim: [], reasoningFailure: [] }

  const entries = (raw as { paragraphs?: unknown })?.paragraphs
  if (!Array.isArray(entries)) return allUnknown(paragraphCount)

  const result = allUnknown(paragraphCount)
  const seen = new Set<number>()

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const { index, role, hasWarrant, statesClaim, reasoningFailure } = entry as Record<
      string,
      unknown
    >

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
    // `statesClaim` falls back to the ROLE rather than to false, and that
    // asymmetry with `warranted` is deliberate. A relay that predates this
    // field returns entries without it, and defaulting those to false would
    // zero `governingClaims` for every user on the older deployment — a
    // regression shipped by a client change, in a two-repo release where the
    // client can reach production first. `role === 'claim'` is exactly what
    // the component counted before the field existed, so an old payload keeps
    // scoring the way it always did.
    result.statesClaim[index - 1] =
      typeof statesClaim === 'boolean' ? statesClaim : role === 'claim'
    // Defaults to 'none', like `warranted` defaults to false and for the same
    // reason: a relay that predates the field says nothing, and inventing an
    // accusation out of silence is the one direction this must not fail. An
    // unrecognised string is also 'none' — a future member the client does not
    // know about has no message to render.
    result.reasoningFailure[index - 1] =
      typeof reasoningFailure === 'string' && VALID_FAILURES.has(reasoningFailure)
        ? (reasoningFailure as ReasoningFailure)
        : 'none'
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
