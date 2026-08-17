import { claimEvidenceFor } from '@shared/claimEvidence'
import { computeClaimSpans } from '@shared/claimSpans'
import { findCitationInsertPoint } from '@shared/citationInsertPoint'
import { hasInlineCitationNear } from '@shared/inlineCitation'
import { hasRelevantSource, problemKindsFor } from '@shared/problemKind'
import type { ScreenWatchClaimEvidence, ScreenWatchProblemKind } from '@shared/ipc-contract'
import type { Claim } from '@shared/types'

// `buildTextMap`/`locate` live in their own file so `npm test` can load them:
// this module's five `@shared/*` imports are exactly what Node's type stripping
// refuses to resolve, and the boundary rule inside `locate` is the piece worth
// pinning (see textMap.test.ts).
import { buildTextMap, locate } from './textMap'

/**
 * Where to draw the underlines over the document editor, and what each one
 * means.
 *
 * The editor's body is an uncontrolled contentEditable — deliberately, because
 * a controlled one resets the caret on every keystroke. That rules out the
 * obvious implementation: wrapping flagged sentences in <mark> elements would
 * mean React rewriting the node the user is typing into, which is the same
 * problem in a worse disguise (the caret survives a re-render only by accident,
 * and execCommand's own formatting would fight the wrappers).
 *
 * So nothing here touches the DOM the user edits. Ranges are measured against
 * it and the marks are drawn in a separate absolutely-positioned layer, which
 * is also how Screen Watch draws them over other applications — same idea, and
 * there the source text isn't even ours to modify. The measurement is
 * throwaway: `Range` objects are created, read for rects, and dropped.
 */

export interface MarkRect {
  left: number
  top: number
  width: number
  height: number
}

/** Everything except 'searching', which never reaches a mark — see measureMarks. */
export type MarkProblemKind = Exclude<ScreenWatchProblemKind, 'searching'>

export interface DocumentMark {
  claim: Claim
  /** Worst first. The mark is coloured by [0]; length > 1 shows a count. */
  problemKinds: MarkProblemKind[]
  hasInlineCitation: boolean
  /**
   * Never null: a claim whose search has not resolved is not marked at all —
   * see the note in measureMarks. Typed non-null so the popover cannot be
   * written against a state that never reaches it.
   */
  evidence: ScreenWatchClaimEvidence
  /**
   * One rect per visual line the claim spans, so a sentence that wraps is
   * underlined on each line it occupies rather than boxed across all of them.
   */
  rects: MarkRect[]
}

/**
 * Measures every flagged claim in the editor and returns where to draw it.
 *
 * `wrap` is the scroll container the marks layer is positioned inside, so rects
 * come back in its coordinate space with scroll folded in — an absolutely
 * positioned child of a scroll container scrolls with the content, so this
 * stays correct without re-measuring on every scroll event.
 *
 * `articleCounts` maps a claim id to how many articles its evidence search
 * returned. It has to be passed in: a persisted `Claim` does not carry one, and
 * the number the popover prints ("5 sources came back…") cannot be derived from
 * anything on the row — see claimEvidenceFor. A claim missing from the map is
 * simply not marked, the same as one whose search has not resolved.
 */
export function measureMarks(
  body: HTMLElement,
  wrap: HTMLElement,
  claims: Claim[],
  articleCounts: ReadonlyMap<string, number>
): DocumentMark[] {
  if (claims.length === 0) return []

  const { text, nodes } = buildTextMap(body)
  if (nodes.length === 0) return []

  const wrapRect = wrap.getBoundingClientRect()
  const marks: DocumentMark[] = []

  for (const span of computeClaimSpans(text, claims)) {
    // Read in its sentence, not on its own. A detected claim is a sub-span —
    // the relay returns the assertion and stops before the "(Author, Year)"
    // that follows it — so testing `span.claim.text` reported a properly cited
    // sentence as uncited. `span` already carries offsets into `text`, so the
    // sentence is right there.
    const cited = hasInlineCitationNear(text, span.start, span.end)
    const evidence = claimEvidenceFor(span.claim, articleCounts.get(span.claim.id))

    // A claim nothing has been searched for yet gets no mark at all.
    //
    // problemKindsFor answers `evidence: null` with 'searching', which is
    // correct where it was written: Screen Watch kicks off a background search
    // for every claim it finds, so null genuinely means "looking right now".
    // Nothing searches automatically in this editor — runStructure is the only
    // relay-touching path and it is explicitly user-initiated — so null here
    // means "never looked", and drawing it would put a "Checking this claim"
    // spinner under every sentence of a document with no search running.
    //
    // Underlining an unchecked claim in any colour makes the same mistake the
    // coverage line used to: reporting a verdict Tracely has not reached.
    //
    // A claim whose article count has not loaded lands here too, and for the
    // same reason: the popover's copy quotes that number, so drawing the mark
    // before it arrives means opening a card that has to invent one.
    if (!evidence) continue

    // The cast is what the `if (!evidence) continue` above earns: 'searching'
    // is returned only for a null evidence input, which cannot reach here.
    const problemKinds = problemKindsFor({
      claimType: span.claim.claimType,
      hasInlineCitation: cited,
      evidence: {
        score: evidence.score,
        count: evidence.count,
        hasRelevantSource: hasRelevantSource(span.claim.scoreBreakdown)
      },
      critiqueVerdict: span.claim.critiqueVerdict
    }) as MarkProblemKind[]
    // Nothing is wrong with this sentence. Not drawing it is the point: a
    // document where every claim is underlined tells the writer nothing.
    if (problemKinds.length === 0) continue

    const from = locate(nodes, span.start)
    const to = locate(nodes, span.end)
    if (!from || !to) continue

    const range = document.createRange()
    try {
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
    } catch {
      // Offsets that no longer address live nodes — the text moved on between
      // detection and this measure. Skipping is right: a mis-placed underline
      // accuses the wrong sentence.
      continue
    }

    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left - wrapRect.left + wrap.scrollLeft,
        top: rect.top - wrapRect.top + wrap.scrollTop,
        width: rect.width,
        height: rect.height
      }))
    if (rects.length === 0) continue

    marks.push({ claim: span.claim, problemKinds, hasInlineCitation: cited, evidence, rects })
  }

  return marks
}

/**
 * Writes an in-text citation into the sentence a claim occupies.
 *
 * Through `execCommand('insertText')` rather than by mutating text nodes, for
 * the same reason the rest of this editor is execCommand-based: it goes on the
 * browser's own undo stack, so Ctrl+Z takes the citation back out. A direct DOM
 * edit is invisible to undo and would silently break the one thing a writer
 * reaches for when an edit surprises them.
 *
 * Placement is `findCitationInsertPoint`'s, which moves back inside the
 * sentence's terminal punctuation — "(Smith, 2020)." rather than ".(Smith,
 * 2020)" — and refuses to move when it cannot tell where the sentence ends.
 *
 * Returns false when the claim can no longer be located, which happens when the
 * draft moved on after the search. Inserting at a guessed offset would drop a
 * citation into the middle of an unrelated sentence.
 */
export function insertCitationForClaim(body: HTMLElement, claim: Claim, inTextCitation: string): boolean {
  const { text, nodes } = buildTextMap(body)
  const span = computeClaimSpans(text, [claim])[0]
  if (!span) return false

  const { offset, prefix } = findCitationInsertPoint(text, span.end)
  const at = locate(nodes, offset)
  if (!at) return false

  const selection = window.getSelection()
  if (!selection) return false
  const range = document.createRange()
  try {
    range.setStart(at.node, at.offset)
    range.collapse(true)
  } catch {
    return false
  }
  selection.removeAllRanges()
  selection.addRange(range)
  body.focus()
  return document.execCommand('insertText', false, `${prefix}${inTextCitation}`)
}

/**
 * Replaces the sentence a claim occupies with the critique's narrowed version.
 *
 * The same `execCommand` argument `insertCitationForClaim` makes, and it matters
 * more here: this one replaces a whole sentence rather than adding four words to
 * the end of it, so a writer who dislikes the result needs Ctrl+Z to be the
 * thing that undoes it. `insertText` over a NON-COLLAPSED selection deletes the
 * selection and inserts in a single undoable step — the reason the range is
 * selected and typed over rather than deleted and then filled, which would cost
 * two presses of Ctrl+Z and leave the sentence gone after the first. Measured
 * rather than assumed (2026-08-17, Chromium, against a live contentEditable
 * holding two paragraphs): one execCommand('undo') restored the original text
 * exactly and left the following paragraph untouched.
 *
 * Returns false when the claim can no longer be located, exactly as
 * `insertCitationForClaim` does and for the same reason: the draft has moved on
 * since the critique ran, and rewriting at a guessed offset would replace a
 * sentence the writer never asked about. The caller says so rather than
 * silently doing nothing.
 *
 * What it will and will not put in the document is not this function's
 * judgement — see `normalizeCritique.isNarrowing`, which drops any revision that
 * introduces a named thing the original sentence does not contain. This writes
 * whatever survived that.
 */
export function replaceClaimText(body: HTMLElement, claim: Claim, replacement: string): boolean {
  const { text, nodes } = buildTextMap(body)
  const span = computeClaimSpans(text, [claim])[0]
  if (!span) return false

  const from = locate(nodes, span.start)
  const to = locate(nodes, span.end)
  if (!from || !to) return false

  const selection = window.getSelection()
  if (!selection) return false
  const range = document.createRange()
  try {
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
  } catch {
    return false
  }
  // An empty range would make insertText an insertion rather than a
  // replacement, leaving the overstated sentence in place with the narrowed one
  // wedged in front of it.
  if (range.collapsed) return false

  selection.removeAllRanges()
  selection.addRange(range)
  body.focus()
  return document.execCommand('insertText', false, replacement)
}

/** The mark under a point in `wrap`'s coordinate space, if any. */
export function markAt(marks: DocumentMark[], x: number, y: number): { mark: DocumentMark; rect: MarkRect } | null {
  for (const mark of marks) {
    for (const rect of mark.rects) {
      if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) {
        return { mark, rect }
      }
    }
  }
  return null
}
