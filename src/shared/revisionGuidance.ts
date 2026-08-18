import type { StructureWeaknessKind } from './types.ts'

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

export const REVISION_GUIDANCE: Record<StructureWeaknessKind, RevisionGuidance> = {
  'no-thesis': {
    move: 'Write one sentence that someone could disagree with, and put it at the end of your opening section. Start from what you would say if a reader asked "so what are you arguing?" and refuse to answer with a topic.',
    why: 'A thesis is not what the essay is about, it is the position the essay defends. "The effects of social media on teenagers" is a subject; a reader cannot tell whether the rest of the draft succeeded, because nothing was claimed.',
    done: 'Write the opposite of your sentence. If the opposite is something a reasonable person might argue, you have a thesis. If it sounds absurd or meaningless, you still have a topic.'
  },
  'unsupported-claim': {
    move: 'Either find a source that bears on this specific sentence, or narrow the sentence until it matches what you can actually show. Tracely will run the search from here; the narrowing is the part only you can do.',
    why: 'An unsupported claim is not always a claim that is wrong — often it is a claim that is broader than the evidence behind it. Scaling the assertion down to the evidence is a real fix, not a retreat, and it is usually the faster one.',
    done: 'Read the sentence beside the source you found. If the source would satisfy a reader who doubted the sentence, they now match. If you had to explain the difference, narrow it further.'
  },
  'warrant-gap': {
    move: 'After the evidence, answer "so what does this show?" in your own words, before the paragraph ends. One or two sentences, connecting this specific evidence back to the claim it is supposed to support.',
    why: 'Evidence does not speak for itself, and the connection you can see is the one a reader most often cannot. A quotation followed immediately by the next quotation leaves the reasoning in your head instead of on the page — which is also where a marker cannot give you credit for it.',
    done: 'Cover the quotation with your hand. If what is left still tells a reader what you concluded and why, the warrant is there. If what is left is only "as X argues", it is not.'
  },
  'new-claim-in-conclusion': {
    move: 'Move this claim into the body, where it has room to be supported — or cut it. If it matters enough to assert, it matters enough to argue, and the conclusion is the one place with no space left to do that.',
    why: 'A new assertion in the final paragraph arrives after the evidence has stopped. Readers notice the shape even when they cannot name it: the essay appears to be smuggling in the thing it could not defend.',
    done: 'Ask what would support this claim. If the answer is a paragraph you have not written, it belongs in the body. If the answer is a paragraph you already wrote, say so explicitly there instead.'
  },
  'evidence-stacking': {
    move: 'Put a claim of your own between these two paragraphs — the sentence that says what the first piece of evidence established, which the second one now builds on.',
    why: 'Two evidence paragraphs in a row read as a literature review: here is what was found, and here is what else was found. An argument moves, and the sentences that move it are yours, not your sources\'.',
    done: 'Read only your own sentences, skipping every quotation and citation. If they still make an argument in order, the spine is there. If they read as a list of introductions, it is not.'
  },
  'no-counterargument': {
    move: 'Find the strongest objection to your thesis — the one that would worry you if a reader raised it — give it a paragraph in its own best form, and then answer it.',
    why: 'An argument that never meets resistance reads as one that was never tested, and a weak objection is worse than none: it tells a reader you looked for the easiest thing to knock down. The strongest version is also the useful one, because answering it is usually where a thesis gets sharper.',
    done: 'Show the objection paragraph to someone who disagrees with you. If they say "that is not quite my point", you have written the easy version. They should recognise it as theirs.'
  },
  'no-significance': {
    move: 'Say what follows from your argument being true — for whom, and what changes. Give it a place of its own, near the end but before the conclusion restates.',
    why: 'A reader can finish an essay convinced and still not know why they were asked to read it. This is not decoration; it is the claim about consequence that the rest of the draft has earned the right to make.',
    done: 'Check that your sentence would be false if the thesis were false. "This is an important topic today" survives either way and is therefore not doing the work; "then the standard advice to X is backwards" does not.'
  }
}

/** Guidance for a weakness kind. Total over the union, so a new kind added to
 *  `types.ts` fails the typecheck here rather than silently rendering nothing. */
export function guidanceFor(kind: StructureWeaknessKind): RevisionGuidance {
  return REVISION_GUIDANCE[kind]
}
