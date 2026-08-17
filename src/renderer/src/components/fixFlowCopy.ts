import type { ScreenWatchProblemKind } from '@shared/ipc-contract'

/**
 * What the "Suggest fix" card says, on both surfaces.
 *
 * Shared for the same reason `citationFlowCopy.ts` and `problemCopy.ts` are:
 * this card is drawn twice — over Tracely's own document editor
 * (`DocumentMarkLayer`) and over whatever window Screen Watch is watching
 * (`OverlayApp`) — and two copies of these strings would be two products.
 *
 * Unlike those two, this card has NO Figma frame behind it. The design file has
 * the button ("Overlay Mockup - Inline Detection (Reasoning)", node 288:790,
 * labelled "Suggest fix") and nothing it opens: `Find a Source` has three
 * result frames, the reasoning path has none. Everything below is therefore a
 * judgement, written to sit inside the existing card's language rather than to
 * introduce a new one — same header dot, same body type, same button pair.
 *
 * Pure text — no JSX, no colours, for the reason given in problemCopy.ts.
 */

/**
 * The card's header.
 *
 * Not the problem's title again. The popover it replaces has already named what
 * is wrong; repeating it makes pressing the button look like it did nothing,
 * which is the exact complaint this card exists to answer.
 */
export function fixTitle(kind: ScreenWatchProblemKind): string {
  if (kind === 'overstated-claim') return 'Narrow this claim'
  if (kind === 'contradicted-claim') return 'What to check'
  return 'What to change'
}

/** The revision block's label. Matches the widget panel's own CritiqueFixRow,
 *  which has shown these two blocks since before this card existed. */
export const REVISION_LABEL = 'Suggested revision'
export const CITATION_FIX_LABEL = 'Citation, corrected'

/**
 * The line above the proposed sentence.
 *
 * States the rule the relay is held to — only the quantifier, scope or hedge
 * moves — because that rule is the entire reason this button is allowed to put
 * words in a student's sentence at all. A reader who cannot see the constraint
 * has no way to tell this from a ghostwriter, and Tracely's whole position is
 * that it is not one.
 */
export const REVISION_RULE =
  'Same sentence, same claim — only the quantifier is narrowed to what the evidence supports.'

/**
 * The card when the critique produced no replacement text.
 *
 * The common case for `weak-reasoning`, and by design: the relay's prompt sets
 * `suggestedRevision` only for overstatement, and explicitly forbids it for a
 * claim that is wrong rather than merely too strong — "softening a false claim
 * into a vague one is not a fix". So this says why there is nothing to apply
 * instead of manufacturing something to apply, and hands back the critique's
 * own points.
 */
export const NO_REVISION_BODY =
  'There is no one-word fix for this one, and Tracely will not write the replacement sentence for you. What the critique found:'

/** The Apply confirmation — editor only; see the note on the overlay below. */
export const APPLIED_TITLE = 'Sentence narrowed'
export const APPLIED_BODY =
  'Your sentence now claims what the evidence supports. Undo — or Ctrl+Z — puts it back exactly as it was.'

/**
 * Why the overlay offers Copy where the editor offers Apply.
 *
 * Shown as the hint under the overlay's Copy button, so the difference reads as
 * a limit that is being stated rather than as a feature that is missing. Screen
 * Watch reads another application through UI Automation; it can write a short
 * citation at a located offset, but replacing a whole sentence there means
 * selecting a range in someone else's editor and typing over it, which is not
 * something this window can do honestly for arbitrary apps.
 */
export const OVERLAY_APPLY_NOTE = 'Paste it over the sentence yourself — Tracely does not edit other apps.'

/** The claim can no longer be found in the draft, so nothing was rewritten. */
export const APPLY_LOST_CLAIM =
  'Could not find that sentence in the document any more — it may have been edited since the critique ran.'
