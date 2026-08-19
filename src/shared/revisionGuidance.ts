import type { CohesionFindingKind, StructureWeaknessKind } from './types.ts'

/**
 * What to actually DO about each named weakness.
 *
 * `weaknesses.ts` says what is missing and where. Until now that was the whole
 * of it: the report named a warrant gap in the fourth paragraph and stopped,
 * and the only route onward was `tracerPrompt` — a question prefilled into a
 * tutor window that no longer exists. Tracer was removed with the widget
 * rebuild, and nothing replaced the half of the feature it was carrying, so the
 * report has been diagnosing without prescribing ever since.
 *
 * This is the prescription, and it holds the same line the diagnosis does: it
 * describes the MOVE, never the sentence. "Answer 'so what does that show?' in
 * your own words, before the paragraph ends" is a revision instruction. "The
 * data suggest that…" would be a sentence in a student's essay written by a
 * machine, and that is the thing this app does not do — see the header of
 * `weaknesses.ts` and `CRITIQUE_SYSTEM_PROMPT`. A student who follows every
 * word of this guidance has still written every word of their essay.
 *
 * Three fields, because a revision instruction that omits any of them sends
 * people back to the same paragraph twice:
 *
 * - `move` — the thing to do, in the imperative, specific enough to start now.
 * - `why` — what it is for. Without it the guidance is a rule to comply with,
 *   and compliance produces the sentence that technically satisfies the rubric
 *   and helps nobody: the counterargument paragraph that raises an objection
 *   no one holds, the significance line that says "this is important today".
 * - `done` — the test for whether it worked, phrased so the writer can run it
 *   on their own draft without asking anything. This is the field that makes
 *   the other two checkable rather than inspirational.
 *
 * Local templates, no model involved, for the same reason the messages are: a
 * model asked to explain a fix will supply one.
 */

export interface RevisionGuidance {
  /** Imperative. What to do to the draft. */
  move: string
  /** What the move is for — the reasoning the rubric is applying. */
  why: string
  /** A test the writer can run on their own paragraph to see if it worked. */
  done: string
}

export const REVISION_GUIDANCE: Record<
  Exclude<StructureWeaknessKind, 'model-finding'>,
  RevisionGuidance
> = {
  'no-thesis': {
    move: 'Write one sentence someone could disagree with, and put it at the end of your opening.',
    why: 'A thesis is the position you defend, not the subject you picked.',
    done: 'Write its opposite. If that is arguable, you have a thesis.'
  },
  'unsupported-claim': {
    move: 'Find a source for this sentence, or narrow the sentence to what you can show.',
    why: 'Often the claim is not wrong, just wider than the evidence behind it.',
    done: 'Read the sentence beside the source. If you had to explain the gap, narrow further.'
  },
  'warrant-gap': {
    move: 'After the evidence, answer "so what does this show?" in your own words.',
    why: 'The connection you can see is the one a reader most often cannot.',
    done: 'Cover the quotation. If what is left still states your conclusion, the warrant is there.'
  },
  'new-claim-in-conclusion': {
    move: 'Move this claim into the body where it has room to be supported, or cut it.',
    why: 'A new assertion after the evidence stops looks like smuggling.',
    done: 'Ask what would support it. If that is a paragraph you never wrote, it belongs earlier.'
  },
  'evidence-stacking': {
    move: 'Put a claim of your own between these two paragraphs.',
    why: 'Two evidence paragraphs in a row read as a literature review, not an argument.',
    done: 'Read only your own sentences. If they still argue in order, the spine is there.'
  },
  'no-significance': {
    move: 'Say what follows from your argument being true — for whom, and what changes.',
    why: 'A reader can finish convinced and still not know why they were asked to read it.',
    done: 'Check the sentence would be false if your thesis were false.'
  },
  'dropped-evidence': {
    move: 'Add a sentence after the citation saying what that source established.',
    why: 'A paragraph that ends on its source hands the reader a fact and asks them to draw the conclusion.',
    done: 'Delete the quotation. If the paragraph still states your point, the analysis exists.'
  },
  'overreaching-claim': {
    move: 'Replace the absolute with the boundary you can defend — who, when, how often.',
    why: 'One exception defeats an absolute, which makes it the easiest sentence to argue with.',
    done: 'Try to think of a counter-example. If one comes in a minute, it is still too wide.'
  },
  'unsupported-emphasis': {
    move: 'Cut the word. If the sentence still convinces, leave it cut.',
    why: '“Obviously” asks the reader to agree before you have argued.',
    done: 'Read it to someone who disagrees. If the word was carrying it, they will say so.'
  },
  'unclear-reference': {
    move: 'Put a noun after the demonstrative — the pattern, the gap, whichever you mean.',
    why: 'Across a paragraph break, “this” points at everything you just wrote.',
    done: 'Cover the previous paragraph. If you cannot tell what “this” is, neither can a reader.'
  },
  'restated-conclusion': {
    move: 'Write what your body paragraphs collectively showed that no single one did.',
    why: 'Repeating the thesis tells the reader the essay went nowhere.',
    done: 'Put thesis and conclusion side by side. The second should say something new.'
  },
  'undeveloped-repetition': {
    move: 'Cut the second sentence, then see whether the paragraph lost anything.',
    why: 'Restating a point fills the page and leaves the argument where it was.',
    done: 'Ask what the second sentence adds. If the answer is emphasis, it is repetition.'
  },
  'generic-opening': {
    move: 'Delete the first sentence and start on the second.',
    why: 'A dictionary definition is the opening a marker has read most often.',
    done: 'Ask someone what the essay is about from that line alone.'
  },
  'topic-not-thesis': {
    move: 'Rewrite the opening to say what you believe, not which subject you picked.',
    why: 'Announcing a subject claims nothing, so nothing in the essay can succeed at defending it.',
    done: 'Write its opposite. If that is a position someone holds, you have a thesis.'
  },
  'summary-without-point': {
    move: 'After each source, write one sentence saying what it establishes for your argument.',
    why: 'Reporting what three sources found leaves your argument where it started.',
    done: 'Strike every sentence that reports someone else. If nothing is left, it was a summary.'
  },
  'off-thesis-paragraph': {
    move: 'Decide which is wrong — the paragraph or the thesis — then cut or widen.',
    why: 'A paragraph nobody can connect to your argument reads as padding.',
    done: 'Say in one sentence how it makes your thesis more likely to be true.'
  },
  'vague-significance': {
    move: 'Replace the adverb with specifics: what changed, for whom, by how much.',
    why: 'A sentence nobody can disagree with commits you to nothing.',
    done: 'Ask what a reader could look up to check it. If nothing, it is not yet a claim.'
  },
  'circular-reasoning': {
    move: 'Replace the reason with the fact or mechanism that made you believe the claim.',
    why: 'A reason that restates the claim persuades nobody who doubted it.',
    done: 'Cover the claim and read the support alone. It should still point somewhere.'
  },
  'sequence-as-cause': {
    move: 'Say how the first thing produced the second, and why the obvious alternative does not.',
    why: 'Two things moving together is what you would see if a third caused both.',
    done: 'Ask what would have happened without the cause. A specific answer is a mechanism.'
  },
  'single-case-generalisation': {
    move: 'Say why this case is representative, or narrow the claim to the case you examined.',
    why: 'One example proves the thing is possible, not that it is usual.',
    done: 'Count the cases behind the conclusion. If it is one, the sentence claims more.'
  },
  'logical-leap': {
    move: 'Write out the step you skipped between the evidence and the conclusion.',
    why: 'You reached the conclusion by a route the page never describes.',
    done: 'Give it to someone who disagrees. If they stop at the evidence, the step is missing.'
  },
  'malformed-citation': {
    move: 'Copy the author, year, title and location from the source, in one style.',
    why: 'A citation a reader cannot follow does the opposite of what it is for.',
    done: 'Hand the marker to someone with a search box. They should find it.'
  }
}

/** Guidance for a weakness kind. Total over the union, so a new kind added to
 *  `types.ts` fails the typecheck here rather than silently rendering nothing. */
/**
 * Null for a `'model-finding'`, which carries its own `fix` on the weakness.
 *
 * Not a missing entry: these three fields are a local template for a KIND, and
 * a graded read's finding is not one of a fixed set of kinds. Writing a generic
 * template for it would print the same advice under every model finding, which
 * is worse than printing the specific one the finding already has.
 */
export function guidanceFor(kind: StructureWeaknessKind): RevisionGuidance | null {
  return kind === 'model-finding' ? null : REVISION_GUIDANCE[kind]
}

/**
 * The same three fields for a broken paragraph boundary.
 *
 * Cohesion findings had no guidance at all, because they were a read-only list
 * in the report — a row of red bullets naming boundaries with nothing to do
 * about any of them. They are now their own view where each boundary is opened
 * and worked on, which means each one needs a move.
 *
 * Kept separate from REVISION_GUIDANCE rather than merged into one record: a
 * weakness is about a paragraph and a cohesion finding is about the JOIN
 * between two, so the two vocabularies are about different objects and a
 * combined lookup would take a kind from either union and answer for the wrong
 * one.
 */
export const COHESION_GUIDANCE: Record<CohesionFindingKind, RevisionGuidance> = {
  'no-transition': {
    move: 'Open the second paragraph by naming what the first one established, then turning. One clause is enough — the point is that the reader arrives already knowing why they are here.',
    why: 'A paragraph that starts cold makes the reader do the joining. They can usually manage it, but every join they build themselves is one they might build differently from the one you intended.',
    done: 'Read the last sentence of the first paragraph and the first sentence of the second, back to back and nothing else. If they sound like two people talking past each other, the bridge is still missing.'
  },
  'topic-jump': {
    move: 'Decide whether these two paragraphs belong next to each other at all. If they do, write the sentence that explains the relationship. If they do not, move one — a reordering is a real fix and usually the better one.',
    why: 'No shared vocabulary between adjacent paragraphs usually means the draft is organised by what you found rather than by what you are arguing. That is a structural problem, and a transition sentence pasted over it only hides it.',
    done: 'Say out loud why the second paragraph comes after the first, in one sentence. If the honest answer is "because that is the order I wrote them in", reorder rather than bridge.'
  },
  'unanswered-counterargument': {
    move: 'Reply to the objection before you conclude. Say what it gets right, then what it does not settle — and if you cannot answer it, change the thesis it defeats rather than walking past it.',
    why: 'Raising an objection and then concluding reads as conceding it. The reader is left holding the strongest thing said against you, and your conclusion arrives sounding like it did not notice.',
    done: 'Cover the conclusion. If the draft now ends on the objection and reads as a defeat, the reply is missing — the answer has to sit between them, not inside the closing paragraph.'
  }
}

/** Guidance for a cohesion finding. Total over its union for the same reason. */
export function cohesionGuidanceFor(kind: CohesionFindingKind): RevisionGuidance {
  return COHESION_GUIDANCE[kind]
}
