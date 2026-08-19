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
  'no-significance': {
    move: 'Say what follows from your argument being true — for whom, and what changes. Give it a place of its own, near the end but before the conclusion restates.',
    why: 'A reader can finish an essay convinced and still not know why they were asked to read it. This is not decoration; it is the claim about consequence that the rest of the draft has earned the right to make.',
    done: 'Check that your sentence would be false if the thesis were false. "This is an important topic today" survives either way and is therefore not doing the work; "then the standard advice to X is backwards" does not.'
  },
  'dropped-evidence': {
    move: 'Add a sentence after the citation, in your own words, saying what that source established for your argument. Then read the paragraph again and cut anything the new sentence made redundant.',
    why: 'Evidence is not an argument, it is the raw material for one. A paragraph that ends on its source has handed the reader a fact and asked them to draw the conclusion — and readers who draw it themselves draw it differently from you, while markers do not draw it at all.',
    done: 'Delete the quotation and the citation. If the paragraph still tells a reader what you concluded, the analysis exists. If what is left is a topic sentence and a full stop, it does not.'
  },
  'overreaching-claim': {
    // No quoted replacement here, deliberately: naming the bound is the
    // student's job, and a pair of before-and-after phrases is a sentence to
    // paste. See the test that enforces it.
    move: 'Replace the absolute with the boundary you can actually defend. Name who, when, where or how often — the group you studied rather than everyone, the period your sources cover rather than always.',
    why: 'An absolute claim is defeated by one exception, so it is the easiest thing in your draft to argue against. Narrowing is not retreating: a bounded claim you can support is worth more than a universal one you cannot, and it is usually the more interesting sentence.',
    done: 'Try to think of one counter-example. If you can find one in under a minute, the sentence is still too wide — and if you cannot, write down what makes you sure, because that is the evidence the sentence needs anyway.'
  },
  'unsupported-emphasis': {
    move: 'Cut the word and see whether the sentence still convinces. If it does, leave it cut. If it does not, the missing thing is a reason, and that reason is the sentence to write in its place.',
    why: '"Obviously" and "clearly" ask the reader to agree before you have argued, which has the opposite effect on a reader who does not already agree — it reads as the writer skipping the part they could not do. "Massive" and "devastating" are the same move in adjective form: a conclusion used as a premise.',
    done: 'Read the sentence to someone who disagrees with your thesis. If the word is the only thing carrying it, they will say "no it is not" — and they will be right, because nothing there answers them.'
  },
  'unclear-reference': {
    move: 'Put a noun after the demonstrative. Whatever the opening word is pointing at in the previous paragraph, say it — the pattern, the gap, the discrepancy — so the sentence carries its own referent.',
    why: 'Within a paragraph "this" points at the sentence before it and the reader manages fine. Across a paragraph break it points at everything you just wrote, and the reader has to guess which part you meant. Usually they guess the most obvious part, which is rarely the part you were building on.',
    done: 'Cover the previous paragraph with your hand and read the opening sentence alone. If you cannot tell what "this" is, neither can a reader who has read it once.'
  },
  'restated-conclusion': {
    move: 'Write down what your body paragraphs collectively showed that no single one of them showed on its own. That sentence is your conclusion. The thesis goes in the opening; it does not need saying twice.',
    why: 'A conclusion that repeats the thesis tells the reader the essay went nowhere — they end holding exactly what they were handed on page one. Synthesis is the one move only a conclusion can make, because it is the only paragraph that comes after all the evidence.',
    done: 'Put your thesis and your conclusion side by side. If someone who read only those two sentences would learn nothing from the second, it is a restatement — the second one should be a claim the first had not yet earned.'
  },
  'undeveloped-repetition': {
    move: 'Cut the second sentence, then decide whether the paragraph lost anything. If it did, the thing it lost is the new layer — write that instead. If it did not, the cut is the fix.',
    why: 'Length is not depth. Restating a point in different words fills the page and leaves the argument exactly where it was, and a marker reading closely sees a paragraph that stalled. Real development moves from what happened to why, or from why to what follows.',
    done: 'Ask what the second sentence tells a reader that the first did not. If the honest answer is "the same thing, more emphatically", it is repetition.'
  },
  'generic-opening': {
    move: 'Delete the first sentence and start on the second. Then check whether the new opening is specific to your subject — if it could still introduce a different essay, delete that one too.',
    why: '"Since the beginning of time" and a dictionary definition are the two openings a marker has read most often, and neither tells them anything about your argument. The opening sentence is the one place you have the reader\'s full attention, and spending it on filler spends it on nothing.',
    done: 'Show the first sentence to someone and ask what the essay is about. If they cannot narrow it past "history" or "society", the sentence is not yet yours.'
  },
  'topic-not-thesis': {
    move: 'Rewrite the opening so it says what you believe about the subject, not which subject you picked. Ask yourself what you would say if a reader replied "so what do you think?" — and refuse to answer by naming the topic again.',
    why: 'Announcing a subject makes no claim, so nothing in the essay can succeed or fail at defending it. It also costs you the reader: they have no idea what to watch for, and every paragraph after arrives as more information rather than as support for something.',
    done: 'Write the opposite of your opening sentence. If the opposite is a position a reasonable person might hold, you have a thesis. If the opposite is meaningless, you are still describing a topic.'
  },
  'summary-without-point': {
    move: 'After each source, write one sentence of your own saying what it establishes for your argument. Then read the paragraph back and cut whatever the new sentences made redundant — usually most of the summarising.',
    why: 'Reporting what three sources found puts research on the page and leaves your argument exactly where it was. A marker reading this paragraph learns what you read; they still do not know what you think, and they can only give credit for the second thing.',
    done: 'Strike out every sentence that reports what somebody else said. If nothing is left, the paragraph was a summary. What remains after you fix it should be an argument the sources happen to support.'
  },
  'off-thesis-paragraph': {
    move: 'Decide which one is wrong — the paragraph or the thesis. Either cut the paragraph, or widen the thesis to cover what you actually spent the essay arguing. Both are real fixes and the second is more common than students expect.',
    why: 'A paragraph nobody can connect to your argument reads as padding even when it is the best writing in the draft, because the reader has no slot to put it in. Often it is a sign the essay found its real subject partway through and the introduction never caught up.',
    done: 'Say in one sentence how this paragraph makes your thesis more likely to be true. If the honest answer is that it does not, but you still want to keep it, the thesis is the thing to change.'
  },
  'vague-significance': {
    move: 'Replace the adverb with the specifics. Name what changed, who it changed for, and by how much — a number, a date range, a named group. If you do not know any of those yet, that is the research the sentence still needs.',
    why: 'A sentence built from an abstract subject, a change verb and an intensifier cannot be agreed with or disagreed with, so it persuades nobody and commits you to nothing. It also reads as a placeholder, which is often what it is.',
    done: 'Ask what a reader could look up to check the sentence. If there is nothing — no figure, no period, no population — it is still describing the shape of a claim rather than making one.'
  },
  'circular-reasoning': {
    move: 'Find the sentence meant to support the claim and check whether it says anything the claim did not. If it does not, replace it with the reason you actually believe the claim — the fact, mechanism or consequence that would persuade someone who started out disagreeing.',
    why: 'A reason that restates the claim moves nobody, because anyone who doubted the claim doubts the restatement for identical reasons. It also tends to hide from the writer: the paragraph feels supported because the point has been made twice.',
    done: 'Cover the claim and read only the support. If a reader could work out what you were arguing for from the support alone, it is doing work. If the support only makes sense once you already know the claim, it is the claim again.'
  },
  'sequence-as-cause': {
    move: 'Say HOW the first thing produced the second — the process in between. Then name the most obvious alternative explanation and say why it does not account for what you are describing.',
    why: 'Order is not causation and neither is correlation. Two things moving together is exactly what you would see if a third thing drove both, or if the causation ran the other way, and a reader who thinks of that before you do stops trusting the rest of the paragraph.',
    done: 'Ask what would have happened without the cause you name. If you can answer with something specific, you have a mechanism. If the honest answer is that you do not know, the claim needs narrowing to what the evidence shows: that the two occur together.'
  },
  'single-case-generalisation': {
    move: 'Either say why this case is representative — what makes it typical rather than convenient — or narrow the conclusion to the case you actually examined. Both are honest; only the first keeps the general claim.',
    why: 'One example proves the thing is possible, not that it is usual. A reader who can name a counter-example has defeated the whole paragraph, and the counter-example is easy to find precisely because the claim was general.',
    done: 'Count the cases behind the conclusion. If the answer is one, read the sentence again and ask whether it claims more than one case can carry.'
  },
  'logical-leap': {
    move: 'Write out the step you skipped. Put your evidence and your conclusion side by side, say in one sentence what has to be true for the second to follow from the first, and then decide whether you have shown it.',
    why: 'The connection you can see is the one a reader most often cannot, because you arrived at the conclusion by a route the page never describes. A missing step reads as a jump, and a marker cannot give credit for reasoning that stayed in your head.',
    done: 'Hand the paragraph to someone who disagrees with you and ask what it establishes. If they stop at the evidence and do not reach your conclusion, the step between them is still missing.'
  },
  'malformed-citation': {
    move: 'Open the source and copy the four things a reader needs from it: who wrote it, when, what it is called, and where it lives. Then write the in-text marker and the reference-list entry from those, in one style, and use that style everywhere.',
    why: 'A citation exists so a reader can go and check you. One they cannot follow does the opposite of what it is for — and a marker who cannot find your source has no way to tell a formatting slip from an invented reference, so they mark it as the worse of the two.',
    done: 'Hand your marker to someone with a library search box and ask them to find the source. If they can, the citation works. If they come back asking you which one you meant, something a reader needs is still missing.'
  }
}

/** Guidance for a weakness kind. Total over the union, so a new kind added to
 *  `types.ts` fails the typecheck here rather than silently rendering nothing. */
export function guidanceFor(kind: StructureWeaknessKind): RevisionGuidance {
  return REVISION_GUIDANCE[kind]
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
