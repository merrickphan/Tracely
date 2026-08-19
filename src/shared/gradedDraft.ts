import type { ParagraphRole, StructureComponents } from './types.ts'

/**
 * What the relay's graded read returns, and what has to be true before any of
 * it reaches a student.
 *
 * The old design's guarantee was that every word a student read came from a
 * local template, so an invented paragraph could not appear in a report that is
 * supposed to be a reading of their draft. Moving the judgement to a model
 * gives that up. This file is what replaces it:
 *
 * **A finding about words must quote those words, and the quote must be in the
 * draft.** Anything else is dropped. A finding cannot describe a paragraph the
 * student never wrote if it has to quote a sentence they did — and the same
 * check is what lets "Show me in the document" scroll to a real offset.
 *
 * Everything here is a pure function of (response, draft). A leaf with a
 * type-only import, so `npm test` can load it.
 */

/** Maxima for the six components. The client owns the arithmetic; see scoreDraft.ts. */
export const COMPONENT_MAX: StructureComponents = {
  thesis: 20,
  governingClaims: 20,
  warrant: 20,
  counterargument: 15,
  significance: 15,
  conclusion: 10
}

export type ComponentKey = keyof StructureComponents

export const COMPONENT_KEYS: ComponentKey[] = [
  'thesis',
  'governingClaims',
  'warrant',
  'counterargument',
  'significance',
  'conclusion'
]

/**
 * The rubric sections a finding may be attributed to.
 *
 * Mirrors `RUBRIC_SECTIONS` in the relay's `lib/prompts.ts`, which is a schema
 * enum, so a well-behaved model cannot return anything else. Checked again here
 * because "the relay constrains it" is a statement about a deployment, and this
 * codebase has already been wrong once about what was deployed.
 */
export const RUBRIC_SECTIONS: readonly string[] = [
  'THESIS / CENTRAL ARGUMENT',
  'CLAIMS',
  'EVIDENCE',
  'ANALYSIS / REASONING',
  'DEPTH',
  'COUNTERARGUMENTS / NUANCE',
  'PARAGRAPH QUALITY',
  'ORGANIZATION',
  'RELEVANCE',
  'INTRODUCTIONS',
  'CONCLUSIONS',
  'STYLE / CLARITY',
  'COHESION',
  'PRECISION',
  'COMPARISONS',
  'CAUSE / EFFECT',
  'SOURCE USE',
  'SYNTHESIS',
  'PERSUASIVENESS',
  'EFFICIENCY'
]

export type GradeSeverity = 'major' | 'minor'
export type ReasoningFailure = 'none' | 'circular' | 'sequence-as-cause' | 'single-case' | 'leap'

export interface GradeParagraph {
  index: number
  role: ParagraphRole
  statesClaim: boolean
  hasWarrant: boolean
  reasoningFailure: ReasoningFailure
}

export interface GradeComponent {
  score: number
  /** The sentence that earned or cost the marks. Empty when the thing is absent. */
  quote: string
  reason: string
}

export interface GradeFinding {
  /** 1-based, or null for something the draft is missing entirely. */
  paragraphIndex: number | null
  rubricSection: string
  severity: GradeSeverity
  label: string
  quote: string
  message: string
  fix: string
}

export interface GradedDraft {
  paragraphs: GradeParagraph[]
  components: Record<ComponentKey, GradeComponent>
  counterargumentApplicable: boolean
  findings: GradeFinding[]
  summary: string
}

/** A verified finding, carrying where its quote actually sits in the draft. */
export interface LocatedFinding extends GradeFinding {
  /** Character offsets into the ORIGINAL draft, or null for an absence. */
  span: { start: number; end: number } | null
}

export interface VerifiedGrade {
  paragraphs: GradeParagraph[]
  components: Record<ComponentKey, GradeComponent>
  counterargumentApplicable: boolean
  findings: LocatedFinding[]
  summary: string
  /** How many findings were thrown away, and why. Surfaced for diagnosis, never to the student. */
  dropped: { reason: string; label: string }[]
}

const ROLES: readonly ParagraphRole[] = [
  'thesis',
  'claim',
  'evidence',
  'reasoning',
  'significance',
  'counterargument',
  'conclusion',
  'transition',
  'unknown'
]

const FAILURES: readonly ReasoningFailure[] = [
  'none',
  'circular',
  'sequence-as-cause',
  'single-case',
  'leap'
]

/**
 * Whitespace-insensitive search that reports the span in the ORIGINAL string.
 *
 * The model is sent paragraphs joined with blank lines and prefixed with "[3] ",
 * and it re-emits a quote by copying — through a JSON encoder, from text whose
 * line breaks it never saw as line breaks. So an exact `indexOf` fails on
 * quotes that are otherwise perfect, and dropping those would throw away real
 * findings for a whitespace difference.
 *
 * Normalising both sides and keeping an index map is what lets the finding
 * survive AND still point at a real offset, which is what the underline needs.
 */
export function locateQuote(
  draft: string,
  quote: string
): { start: number; end: number } | null {
  const cleaned = quote
    // Models add these back despite being told not to. Cheaper to tolerate than
    // to discard a correct finding over a decoration.
    .replace(/^\s*["'“”‘’]+/, '')
    .replace(/["'“”‘’]+\s*$/, '')
    .replace(/^\.{3}|…/, '')
    .replace(/^\s*\[\d+\]\s*/, '')
    .trim()
  if (cleaned.length < 8) return null

  const map: number[] = []
  let normalized = ''
  let pendingSpace = false
  for (let i = 0; i < draft.length; i++) {
    if (/\s/.test(draft[i])) {
      pendingSpace = normalized.length > 0
      continue
    }
    if (pendingSpace) {
      map.push(i)
      normalized += ' '
      pendingSpace = false
    }
    map.push(i)
    normalized += draft[i]
  }

  const needle = cleaned.replace(/\s+/g, ' ')
  const at = normalized.indexOf(needle)
  if (at === -1) return null

  const start = map[at]
  // `map` holds the original index of each normalized character, so the end is
  // one past the original index of the last one — not start + needle.length,
  // which would be wrong wherever the original had a newline or a double space.
  const end = map[at + needle.length - 1] + 1
  return { start, end }
}

function clampScore(value: unknown, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0
  return Math.max(0, Math.min(max, n))
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Everything the client is willing to believe from one graded read.
 *
 * `paragraphCount` is how many paragraphs were actually SENT. The model is told
 * to use those numbers and generally does, but an index outside the range would
 * put a finding on a paragraph that does not exist — the exact failure the
 * report has already shipped once, from a different cause.
 */
export function verifyGrade(
  raw: unknown,
  draft: string,
  paragraphCount: number
): VerifiedGrade | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>

  const paragraphs: GradeParagraph[] = []
  const seen = new Set<number>()
  for (const entry of Array.isArray(body.paragraphs) ? body.paragraphs : []) {
    if (!entry || typeof entry !== 'object') continue
    const p = entry as Record<string, unknown>
    const index = typeof p.index === 'number' ? Math.round(p.index) : -1
    if (index < 1 || index > paragraphCount || seen.has(index)) continue
    seen.add(index)
    const role = ROLES.includes(p.role as ParagraphRole) ? (p.role as ParagraphRole) : 'unknown'
    const failure = FAILURES.includes(p.reasoningFailure as ReasoningFailure)
      ? (p.reasoningFailure as ReasoningFailure)
      : 'none'
    paragraphs.push({
      index,
      role,
      statesClaim: p.statesClaim === true,
      hasWarrant: p.hasWarrant === true,
      // A role the model could not place cannot carry a named reasoning fault:
      // the fault is a judgement about an argument, and 'unknown' means it did
      // not find one to judge.
      reasoningFailure: role === 'unknown' ? 'none' : failure
    })
  }
  // A gap means the model skipped a paragraph. 'unknown' is the honest label
  // and the one the score treats as unread — never a guess to fill the vector.
  for (let i = 1; i <= paragraphCount; i++) {
    if (!seen.has(i)) {
      paragraphs.push({
        index: i,
        role: 'unknown',
        statesClaim: false,
        hasWarrant: false,
        reasoningFailure: 'none'
      })
    }
  }
  paragraphs.sort((a, b) => a.index - b.index)

  const rawComponents = (body.components ?? {}) as Record<string, unknown>
  const components = {} as Record<ComponentKey, GradeComponent>
  for (const key of COMPONENT_KEYS) {
    const c = (rawComponents[key] ?? {}) as Record<string, unknown>
    components[key] = {
      score: clampScore(c.score, COMPONENT_MAX[key]),
      quote: asString(c.quote),
      reason: asString(c.reason)
    }
  }

  const dropped: { reason: string; label: string }[] = []
  const findings: LocatedFinding[] = []
  const seenQuotes = new Set<string>()

  for (const entry of Array.isArray(body.findings) ? body.findings : []) {
    if (!entry || typeof entry !== 'object') continue
    const f = entry as Record<string, unknown>
    const label = asString(f.label) || 'Finding'

    if (!RUBRIC_SECTIONS.includes(asString(f.rubricSection))) {
      dropped.push({ reason: 'rubric section not in the rubric', label })
      continue
    }

    const message = asString(f.message)
    if (!message) {
      dropped.push({ reason: 'no message', label })
      continue
    }

    const index =
      typeof f.paragraphIndex === 'number' ? Math.round(f.paragraphIndex) : null
    if (index !== null && (index < 1 || index > paragraphCount)) {
      dropped.push({ reason: `paragraph ${index} does not exist`, label })
      continue
    }

    const quote = asString(f.quote)
    let span: { start: number; end: number } | null = null
    if (quote) {
      span = locateQuote(draft, quote)
      if (!span) {
        // The load-bearing one. A quote the draft does not contain means the
        // model is describing something the student did not write.
        dropped.push({ reason: 'quote not found in the draft', label })
        continue
      }
      // One finding per span. Two findings on one sentence read as two
      // problems, which is the over-flagging complaint in a different shape.
      const key = `${span.start}:${span.end}`
      if (seenQuotes.has(key)) {
        dropped.push({ reason: 'duplicate quote', label })
        continue
      }
      seenQuotes.add(key)
    } else if (index !== null) {
      // No quote but a paragraph number: the model is asserting an absence
      // inside one paragraph, which it was told to report as a whole-draft
      // finding. Keep it, but as what it is.
      span = null
    }

    findings.push({
      paragraphIndex: index,
      rubricSection: asString(f.rubricSection),
      severity: f.severity === 'minor' ? 'minor' : 'major',
      label,
      quote,
      message,
      fix: asString(f.fix),
      span
    })
  }

  return {
    paragraphs,
    components,
    counterargumentApplicable: body.counterargumentApplicable !== false,
    findings,
    summary: asString(body.summary),
    dropped
  }
}

/**
 * The /100, summed from the model's component scores.
 *
 * The model judges and this adds up, so the same draft scores the same number
 * and every point traces to a quoted sentence. Counterargument leaves the
 * DENOMINATOR when the draft does not attempt one — the rubric says not to
 * require one of every essay, and Tracely is never shown the assignment.
 */
export function scoreFromComponents(
  components: Record<ComponentKey, GradeComponent>,
  counterargumentApplicable: boolean
): { score: number; components: StructureComponents } {
  const values = {} as StructureComponents
  let earned = 0
  let applicable = 0
  for (const key of COMPONENT_KEYS) {
    const score = components[key].score
    values[key] = score
    if (key === 'counterargument' && !counterargumentApplicable) continue
    earned += score
    applicable += COMPONENT_MAX[key]
  }
  return {
    score: applicable === 0 ? 0 : Math.round((earned / applicable) * 100),
    components: values
  }
}

/**
 * The numbered paragraphs the grader is sent.
 *
 * Deliberately NOT `buildStructurePrompt`, which windows each paragraph to its
 * opening and closing moves. That is right for labelling — a paragraph's ROLE
 * lives at its edges — and wrong here. This call judges whether the evidence
 * supports the claim and quotes the sentence it is talking about, both of which
 * live in the middle it would have elided. A finding quoting text that was
 * never sent cannot be located, and would be dropped by `verifyGrade`.
 *
 * So paragraphs go whole, and the budget is spent by dropping WHOLE paragraphs
 * off the end rather than the middle of every one. Paragraphs that do not fit
 * are never labelled, and `verifyGrade` fills them with 'unknown' — the honest
 * label for "not read".
 */
export function buildGradePrompt(
  paragraphTexts: string[],
  limits: { maxParagraphs: number; maxInputChars: number }
): string {
  const lines: string[] = []
  let used = 0

  for (const [i, text] of paragraphTexts.slice(0, limits.maxParagraphs).entries()) {
    const line = `[${i + 1}] ${text.trim()}`
    // Stop at a whole paragraph. A partial entry would invite a quote from a
    // sentence the model only saw half of.
    if (used + line.length + 2 > limits.maxInputChars) break
    lines.push(line)
    used += line.length + 2
  }

  return lines.join('\n\n')
}
