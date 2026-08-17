import type { ParagraphRole } from '@shared/types'

/**
 * How well one paragraph leads into the next.
 *
 * The rest of the structure engine asks whether the argument's PARTS are there
 * (scoreDraft.ts) and whether each part does its job (weaknesses.ts). Nothing
 * asked whether they are joined, which is the single most common thing a marker
 * writes in a margin: the paragraphs are individually fine and the essay still
 * reads as a list.
 *
 * DETERMINISTIC, like every other number this app puts in front of a student —
 * same stance as `scoreDraft.ts` and `search/scoring.ts`, for the same reason: a
 * score someone is asked to act on has to be one they can argue with. Nothing
 * here is a model output, and the findings are local templates.
 *
 * NO DRAFT PROSE LEAVES THIS MODULE. A `DocumentOutline` carries indices,
 * roles, booleans and ids and never the student's words (see paragraphSplit.ts)
 * — the renderer re-derives the text itself. Findings name paragraphs by
 * number, never by quoting them.
 *
 * Deliberately a LEAF: type-only imports, no relative value imports, so
 * `npm test` can load it under Node's type stripping. See roles.ts for why that
 * constraint exists and what it is worth.
 */

/**
 * Openers that explicitly bridge to the previous paragraph.
 *
 * Matched only at the START of the paragraph, the same rule roles.ts applies to
 * its own marker lists: "however" three sentences in is an ordinary contrast
 * inside one point, not a hinge between two paragraphs.
 */
const TRANSITION_MARKERS = [
  // contrast
  'however',
  'but',
  'yet',
  'still',
  'nevertheless',
  'nonetheless',
  'by contrast',
  'in contrast',
  'on the other hand',
  'conversely',
  'even so',
  'that said',
  'admittedly',
  'granted',
  // addition
  'moreover',
  'furthermore',
  'in addition',
  'additionally',
  'similarly',
  'likewise',
  'equally',
  'again',
  'beyond',
  // consequence
  'therefore',
  'thus',
  'hence',
  'consequently',
  'as a result',
  'accordingly',
  'so',
  // sequence / reference back
  'first',
  'second',
  'third',
  'finally',
  'next',
  'then',
  'meanwhile',
  'ultimately',
  'in conclusion',
  'to conclude',
  'in summary',
  'taken together',
  'this',
  'these',
  'those',
  'such',
  'that',
  'if',
  'while',
  'although',
  'though',
  'because',
  'since',
  'once',
  'where',
  'when',
  'building on',
  'having',
  'given'
]

/**
 * Words that carry no topic. Overlap is measured over what is left, so that two
 * paragraphs sharing only "the", "that" and "which" count as sharing nothing.
 *
 * Short list on purpose: the measure is a ratio over the shorter paragraph's
 * vocabulary, so a missing stopword costs a little precision, while an
 * over-aggressive list would strip real subject nouns.
 */
const STOPWORDS = new Set(
  `a an the and or but if of in on at to for from by with without within into onto over under
   is are was were be been being am do does did doing have has had having will would can could
   shall should may might must not no nor so than then that this these those there here it its
   as also very more most much many some any all both each other another such own same too only
   just about after before during while when where which who whom whose what why how they them
   their his her he she we us our you your i my me one two three first second`.split(/\s+/)
)

/** Content words, lowercased, crudely de-inflected so "policy"/"policies" meet. */
function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []
  const out = new Set<string>()
  for (const word of words) {
    if (word.length < 4 || STOPWORDS.has(word)) continue
    out.add(stem(word))
  }
  return out
}

/**
 * Suffix stripping, not a real stemmer.
 *
 * Enough for "emissions"/"emission", "policies"/"policy", "rising"/"rise" to
 * count as the same topic word. A real stemmer would be a dependency for a
 * measure whose whole job is a rough ratio.
 */
function stem(word: string): string {
  if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`
  if (word.endsWith('sses')) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) return word.slice(0, -1)
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3)
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2)
  return word
}

/**
 * Shared topic vocabulary as a fraction of the SMALLER paragraph's vocabulary,
 * not of the union.
 *
 * Jaccard over the union punishes a short paragraph for being short: a two-line
 * transition that repeats the previous paragraph's subject exactly would still
 * score near zero against a long one. What this measure is asking is "does the
 * next paragraph pick anything up?", and that is an overlap coefficient.
 */
function topicOverlap(a: Set<string>, b: Set<string>): number {
  const smaller = a.size <= b.size ? a : b
  const larger = smaller === a ? b : a
  if (smaller.size === 0) return 0
  let shared = 0
  for (const word of smaller) if (larger.has(word)) shared++
  return shared / smaller.size
}

/** The paragraph's opening, where a transition marker would sit. */
function opening(text: string): string {
  return text.slice(0, 60).toLowerCase()
}

const OPENER = new Map<string, RegExp>()
function startsWithTransition(text: string): boolean {
  const head = opening(text)
  return TRANSITION_MARKERS.some((marker) => {
    let re = OPENER.get(marker)
    if (!re) {
      // Same shape as roles.ts's openerFor: an optional quote/bracket and an
      // optional coordinator may precede the marker.
      re = new RegExp(String.raw`^["'‘“(\[]?\s*(?:and|but|so|yet)?\s*${marker}\b`)
      OPENER.set(marker, re)
    }
    return re.test(head)
  })
}

/**
 * Role pairs that are joined by what they ARE, whatever words open them.
 *
 * A claim followed by the evidence for it, or evidence followed by the
 * reasoning about it, is a bridged boundary — the second paragraph is about the
 * first by construction. Flagging those as disconnected would be the measure
 * arguing with the structure the rest of the engine just identified.
 */
function rolesBridge(from: ParagraphRole, to: ParagraphRole): boolean {
  if (from === 'claim' && (to === 'evidence' || to === 'reasoning')) return true
  if (from === 'evidence' && (to === 'reasoning' || to === 'evidence')) return true
  if (to === 'transition' || from === 'transition') return true
  return false
}

/** Overlap at or above this reads as the same subject continuing. */
const TOPIC_FLOOR = 0.18

export type CohesionFindingKind = 'no-transition' | 'topic-jump' | 'unanswered-counterargument'

export interface CohesionFinding {
  kind: CohesionFindingKind
  /** 1-based paragraph the boundary runs FROM. */
  fromIndex: number
  /** 1-based paragraph the boundary runs TO. */
  toIndex: number
  /** Local template, never model prose and never the draft's own words. */
  message: string
}

export interface DraftCohesion {
  /** 0-100, the mean of every boundary's score. 100 for a one-paragraph draft. */
  score: number
  /** How many paragraph boundaries the score is averaged over. */
  boundaries: number
  findings: CohesionFinding[]
}

export interface CohesionParagraph {
  index: number
  role: ParagraphRole
  text: string
}

/**
 * Each boundary scores out of 1:
 *
 *   0.5  an explicit transition at the opening, OR a role pair that bridges
 *        itself (claim → evidence)
 *   0.5  topic overlap, scaled — full credit at twice the floor
 *
 * Both halves earn independently, so a paragraph that signposts AND carries the
 * subject forward scores 1, one that does neither scores 0, and the common case
 * — carries the subject, never signposts — lands mid. That is the right shape:
 * an unsignposted continuation is a real weakness in a graded essay and not the
 * same failure as changing the subject with no warning.
 */
export function measureCohesion(paragraphs: CohesionParagraph[]): DraftCohesion {
  if (paragraphs.length < 2) {
    // Nothing to bridge. 100 rather than 0 — an ungraded boundary that does not
    // exist must not read as a failed one.
    return { score: 100, boundaries: 0, findings: [] }
  }

  const vocab = paragraphs.map((paragraph) => contentWords(paragraph.text))
  const findings: CohesionFinding[] = []
  let total = 0

  for (let i = 1; i < paragraphs.length; i++) {
    const from = paragraphs[i - 1]
    const to = paragraphs[i]
    const signalled = startsWithTransition(to.text) || rolesBridge(from.role, to.role)
    const overlap = topicOverlap(vocab[i - 1], vocab[i])
    const topicCredit = Math.min(1, overlap / (TOPIC_FLOOR * 2))
    total += (signalled ? 0.5 : 0) + 0.5 * topicCredit

    if (!signalled && overlap < TOPIC_FLOOR) {
      findings.push({
        kind: 'topic-jump',
        fromIndex: from.index,
        toIndex: to.index,
        message: `¶${from.index} → ¶${to.index} — no transition, and the two paragraphs share almost no subject matter.`
      })
    } else if (!signalled) {
      findings.push({
        kind: 'no-transition',
        fromIndex: from.index,
        toIndex: to.index,
        message: `¶${from.index} → ¶${to.index} — nothing bridges these paragraphs; the next one starts cold.`
      })
    }

    // A counterargument the draft never answers. The objection is raised and
    // the essay walks straight into its ending, which reads as conceding it.
    if (from.role === 'counterargument' && to.role === 'conclusion') {
      findings.push({
        kind: 'unanswered-counterargument',
        fromIndex: from.index,
        toIndex: to.index,
        message: `¶${from.index} raises an objection and ¶${to.index} concludes without replying to it.`
      })
    }
  }

  return {
    score: Math.round((total / (paragraphs.length - 1)) * 100),
    boundaries: paragraphs.length - 1,
    findings
  }
}
