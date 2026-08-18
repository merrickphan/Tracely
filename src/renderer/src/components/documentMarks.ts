import { claimEvidenceFor } from '@shared/claimEvidence'
import { computeClaimSpans } from '@shared/claimSpans'
import { findCitationInsertPoint } from '@shared/citationInsertPoint'
import { findProseIssues, type ProseIssue } from '@shared/proseIssues'
import { isCitedInScope } from '@shared/citationScope'
import { hasRelevantSource, problemKindsFor } from '@shared/problemKind'
import { findWorksCitedSection, planWorksCited } from '@shared/worksCited'
import type { ScreenWatchClaimEvidence, ScreenWatchProblemKind } from '@shared/ipc-contract'
import type { CitationStyle, Claim } from '@shared/types'

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
    // Paragraph scope, not sentence scope — a sentence carrying an earlier
    // citation forward does not need one of its own. See citationScope.ts.
    const cited = isCitedInScope(text, span.start, span.end)
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
 * A grammar, mechanics or wordiness issue, measured for drawing.
 *
 * Its own type and its own pass rather than another `DocumentMark`, because a
 * DocumentMark IS a claim — it carries evidence, a citation state and a
 * problemKind ranking, none of which a repeated word has. Faking a Claim to
 * reuse the layer would put "unverified statistic" one field away from "a/an".
 *
 * The two layers are drawn separately and coloured differently on purpose. The
 * three underline colours in this app mean something specific about
 * CREDIBILITY — see PROBLEM_COLOR — and a grammar flag is not a claim about
 * whether a sentence is true. Sharing a colour would teach the writer that the
 * orange under "70% of teenagers" and the orange under "the the" are the same
 * kind of remark.
 */
export interface ProseMark {
  issue: ProseIssue
  rects: MarkRect[]
}

/**
 * Measures every prose issue in the editor.
 *
 * Reads the same text map the claim pass does, so the two agree about where
 * the document's characters are. `findProseIssues` is pure and cheap — a
 * thousand-word draft is a few milliseconds — so this runs in the same measure
 * pass as the marks rather than behind a debounce of its own.
 */
export function measureProseMarks(body: HTMLElement, wrap: HTMLElement): ProseMark[] {
  const { text, nodes } = buildTextMap(body)
  if (nodes.length === 0) return []

  const wrapRect = wrap.getBoundingClientRect()
  const marks: ProseMark[] = []

  for (const issue of findProseIssues(text)) {
    const from = locate(nodes, issue.start)
    const to = locate(nodes, issue.end)
    if (!from || !to) continue

    const range = document.createRange()
    try {
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
    } catch {
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

    marks.push({ issue, rects })
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
 * Selects [start, end) of the reconstructed text and writes `replacement` over
 * it with the browser's own insert.
 *
 * `execCommand('insertText')` for the same reason `insertCitationForClaim` uses
 * it, and it is the whole reason the works-cited section is written as text
 * rather than assembled as markup: it is ONE undo step over a collapsed or
 * spanning selection, so Ctrl+Z (and the card's Undo, which is that same stack)
 * takes the entry back out. Rebuilding the section by DOM surgery would be
 * invisible to undo, and would leave a reference behind after the citation that
 * created it had been undone.
 *
 * Measured rather than assumed (2026-08-17, Chromium, against a live
 * contentEditable holding two paragraphs): `insertText` over a NON-COLLAPSED
 * selection deletes the selection and inserts in a single undoable step, and
 * one `execCommand('undo')` restored the original text exactly while leaving
 * the following paragraph untouched. That is why the range is selected and
 * typed over rather than deleted and then filled, which would cost two presses
 * of Ctrl+Z and leave the sentence gone after the first.
 *
 * Newlines in `replacement` become real block breaks — this is the same path a
 * multi-line paste takes.
 */
function replaceRange(
  body: HTMLElement,
  start: number,
  end: number,
  replacement: string,
  /**
   * Refuse a collapsed range.
   *
   * The caller's choice because both answers are right somewhere here. Writing
   * a narrowed sentence over an overstated one MUST replace: an empty range
   * would make this an insertion and leave the original in place with the
   * replacement wedged in front of it. Adding a works-cited section to a draft
   * that has none is legitimately an insertion at the end of the document, and
   * a blanket guard would reject exactly that.
   */
  mustReplace = false
): boolean {
  const { nodes } = buildTextMap(body)
  const from = locate(nodes, start)
  const to = locate(nodes, end)
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
  if (mustReplace && range.collapsed) return false

  selection.removeAllRanges()
  selection.addRange(range)
  body.focus()
  return document.execCommand('insertText', false, replacement)
}

/**
 * Replaces the sentence a claim occupies with the critique's narrowed version.
 *
 * A thin caller of `replaceRange` — the undo argument that makes this safe is
 * written out there, and the two paths that write into the writer's document
 * share it rather than each doing their own range surgery.
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
  const { text } = buildTextMap(body)
  const span = computeClaimSpans(text, [claim])[0]
  if (!span) return false
  return replaceRange(body, span.start, span.end, replacement, true)
}

export type WorksCitedResult = 'added' | 'already-listed' | 'failed'

/**
 * Adds one entry to the document's own works-cited list, creating the section
 * if the document has none.
 *
 * Called BEFORE the in-text marker is written, which is not an accident. The
 * list sits after every sentence in the draft, so writing it first leaves the
 * claim's offsets untouched for `insertCitationForClaim` to locate against; and
 * it puts the marker on top of the undo stack, so the first Ctrl+Z removes the
 * thing the writer is looking at rather than a list off the bottom of the
 * screen. The caller has to undo TWICE to unwind the pair — see
 * `undoFlowCitation`, which knows how many steps its insert took.
 *
 * 'already-listed' is a real answer, not a failure: citing one source for two
 * sentences is normal, and every style lists a work once. The card says so
 * rather than reporting an add that did not happen.
 */
export function addWorksCitedEntry(
  body: HTMLElement,
  { entry, sourceTitle, style }: { entry: string; sourceTitle: string | null; style: CitationStyle }
): WorksCitedResult {
  const { text } = buildTextMap(body)
  const { edit } = planWorksCited({ text, entry, sourceTitle, style })
  if (!edit) return 'already-listed'
  return replaceRange(body, edit.start, edit.end, edit.replacement) ? 'added' : 'failed'
}

/**
 * Scrolls the works-cited section into view — what "View Works Cited" on the
 * confirmation card does, now that there is one to view.
 *
 * `behavior: 'auto'`, never 'smooth', for the reason written out at
 * `selectParagraph` in AnalyzeView: smooth scrolling is compositor-driven and
 * silently does nothing when the window is not compositing frames.
 *
 * Returns false when the document has no section, which the caller should treat
 * as "say nothing" rather than as an error — it means the entry was never
 * written, and that has already been reported by `addWorksCitedEntry`.
 */
export function revealWorksCited(body: HTMLElement): boolean {
  const { text, nodes } = buildTextMap(body)
  const section = findWorksCitedSection(text)
  if (!section) return false
  const at = locate(nodes, section.start)
  if (!at) return false
  // The heading's own block element, not the text node — Text has no
  // scrollIntoView, and the block is what the reader is being shown.
  const target = at.node.parentElement
  if (!target) return false
  target.scrollIntoView({ block: 'center', behavior: 'auto' })
  return true
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
