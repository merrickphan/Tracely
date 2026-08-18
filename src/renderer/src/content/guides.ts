/**
 * The four Resources guides on Home.
 *
 * Content, not layout, and the reason it is a module rather than JSX: these are
 * documents. They want to be readable and editable as prose, and rewriting one
 * should not mean touching a component.
 *
 * They are written to be about THIS app's model of an essay, not general study
 * advice — the rubric guide names the six components `structure/scoreDraft.ts`
 * actually scores and the weights it uses, and the sources guide describes the
 * four indexes `search/aggregator.ts` actually queries and what they cannot
 * hold. A guide that says something the product does not do is worse than no
 * guide, because the reader will act on it and be surprised.
 */

export interface GuideSection {
  heading: string
  /** Paragraphs, rendered in order. */
  body: string[]
  /** An optional list under the paragraphs. */
  bullets?: string[]
  /** An optional aside, drawn as a tinted callout at the end of the section. */
  note?: string
}

export interface Guide {
  id: string
  title: string
  /** The one-liner on the card. Matches the frame's copy exactly. */
  blurb: string
  /** Shown under the title in the reader. */
  standfirst: string
  readMinutes: number
  sections: GuideSection[]
}

export const GUIDES: Guide[] = [
  {
    id: 'persuasive',
    title: 'Persuasive Writing 101',
    blurb: 'Build arguments that hold up.',
    standfirst:
      'An argument is not a set of true sentences. It is a claim, the evidence for it, and the reason that evidence counts — and it is the third one that usually goes missing.',
    readMinutes: 6,
    sections: [
      {
        heading: 'A claim is a sentence someone could disagree with',
        body: [
          '"Social media affects teenagers" is not a claim. Nobody would argue the other side, which means proving it wins you nothing. "Social media use displaces sleep, and the lost sleep explains most of the mood effects people attribute to social media itself" is a claim: it says something specific, it excludes rival explanations, and a reasonable reader could push back on it.',
          'The test is not whether a sentence sounds academic. It is whether the opposite of the sentence is a position a real person holds. If the opposite is obviously false, you are describing rather than arguing, and a marker will say the essay "lacks a thesis" even though there is a sentence in the introduction that looks like one.'
        ],
        bullets: [
          'Too safe: "Climate policy is complicated." Nobody disagrees.',
          'Too big: "Capitalism caused climate change." You cannot support this in 1,500 words.',
          'Arguable: "Carbon pricing failed in Australia for political reasons, not economic ones."'
        ]
      },
      {
        heading: 'Every claim owes a warrant',
        body: [
          'Evidence does not speak for itself. Between "here is a statistic" and "therefore my claim is true" sits an assumption about why that statistic bears on that claim — the warrant. Most weak paragraphs in student writing have good evidence and no warrant. The quote is there, the citation is there, and the sentence explaining what the quote proves is missing, because it felt obvious while writing.',
          'It is never obvious to the reader. A study of 400 undergraduates in one American university does not automatically tell you about teenagers in general, and if your claim is about teenagers you have to say why you think it transfers. That sentence is the argument. The rest is furniture.'
        ],
        note:
          'Tracely scores this directly. "Warrant" is 20 of the 100 points, measured across every paragraph that makes a claim or presents evidence — see the grading rubric guide.'
      },
      {
        heading: 'Concede the strongest version, not the weakest',
        body: [
          'A counterargument paragraph that picks the silliest objection and knocks it over is worse than no counterargument paragraph, because it tells the reader you either could not find a real objection or did not look. Find the best version of the case against you — ideally from someone who actually holds it — and say plainly what it gets right before you say what it misses.',
          'This reads as confidence, and it is also the only honest way to write. If the strongest objection turns out to be right, you have learned something and your thesis should change. That is not a failure of the essay; that is the essay working.'
        ]
      },
      {
        heading: 'Say why it matters, and finish the thought',
        body: [
          'Two things get dropped when a deadline is close: the sentence explaining why the question is worth asking, and a conclusion that does more than restate the introduction. Both are cheap to add and both are scored.',
          'Significance answers "so what" — who is affected, what changes if you are right, what the reader should do differently. A conclusion should land the argument rather than summarise it: what follows from what you have shown, and what you deliberately left unresolved.'
        ]
      },
      {
        heading: 'Hedge exactly as much as your evidence allows',
        body: [
          'Absolute language is the most common thing Tracely flags, and the fix is usually one word. "Fossil fuel companies are the root of all environmental degradation" cannot be supported by any source, so the sentence damages the paragraph it is trying to strengthen. "A major driver of" can be supported, and claims almost as much.',
          'The reverse is also a fault. An essay hedged into mush — "it could be argued that some evidence may suggest" — has no position to defend. Match the strength of the sentence to the strength of what is behind it, and no more.'
        ]
      }
    ]
  },
  {
    id: 'rubric',
    title: 'Standard Grading Rubric',
    blurb: 'See how Tracely scores essays.',
    standfirst:
      'The grade is arithmetic, not an opinion. Six components, fixed weights, computed from the paragraphs — which means you can argue with it.',
    readMinutes: 5,
    sections: [
      {
        heading: 'Why the score is a formula',
        body: [
          'A number a student is asked to act on has to be one they can inspect. If the grade came out of a language model, "why is this a 68" would have no answer beyond "because it said so", and the only way to raise it would be to keep rewriting and re-rolling.',
          'So the score is computed. Every point is attached to a paragraph and a rule, the report shows which paragraph earned or lost what, and a wrong label is visibly wrong rather than mysteriously costly.'
        ]
      },
      {
        heading: 'The six components',
        body: [
          'They add to 100. Nothing else contributes.'
        ],
        bullets: [
          'Thesis — 20. Is there an arguable claim, and is it up front? A thesis in the last third scores half.',
          'Governing claims — 20. What fraction of the body paragraphs state a claim they then support. A fraction, never a count.',
          'Warrant — 20. Of the paragraphs that owe an explanation, how many give one.',
          'Counterargument — 15. Is an objection raised and answered.',
          'Significance — 15. Does the essay say why the question matters.',
          'Conclusion — 10. Does it close the argument rather than repeat the opening.'
        ],
        note:
          'Governing claims is a fraction of the body, not a count, and that is what stops the score being a length proxy. Padding an essay with paragraphs that do not make claims lowers the grade.'
      },
      {
        heading: 'Evidence is reported, not scored',
        body: [
          'How many of your claims have a credible source behind them appears beside the grade as a ratio, and it is deliberately kept out of the 100.',
          'Two reasons. It would double-count — evidence strength already folds in how many sources back a claim. And it would make the grade track how searchable your topic is: a close reading of a novel would cap near 50 because four academic indexes have nothing to say about the text of Macbeth, which is a fact about the databases, not about the essay.'
        ]
      },
      {
        heading: '"Provisional" means something',
        body: [
          'When Tracely cannot tell what a paragraph is doing, it labels it unknown rather than guessing. While any paragraph is unlabelled, the report says provisional and withholds whole-draft findings entirely.',
          '"This draft has no counterargument" is an assertion about paragraphs. If one of them was not read, the claim is not available — a confident number computed from nothing is worse than admitting the gap.'
        ]
      },
      {
        heading: 'What moves a grade fastest',
        body: [
          'In practice, in this order: add the missing warrant sentences (20 points sitting in paragraphs you have already written), move the thesis into the first third, and add a real counterargument paragraph. Those three are worth 55 between them and none requires new research.'
        ]
      }
    ]
  },
  {
    id: 'research',
    title: 'Research Paper Tips',
    blurb: 'Structure, sourcing, citations.',
    standfirst:
      'A research paper is a claim you did not start with. Everything here is about keeping the writing honest about where it came from.',
    readMinutes: 6,
    sections: [
      {
        heading: 'Write the question before the answer',
        body: [
          'Starting from a conclusion and collecting support for it is the most efficient way to write something that will not survive a reader. You will find support — there is support for almost anything — and you will not notice what you skipped.',
          'Write the question down first, in one sentence, and keep it visible. When the sources point somewhere else, the question is what tells you that something interesting happened rather than that you failed.'
        ]
      },
      {
        heading: 'One idea per paragraph, stated first',
        body: [
          'A body paragraph should open with the claim it is making, spend its middle supporting that claim, and end having connected it back to the thesis. If you cannot write the opening sentence, the paragraph is doing two things and wants to be two paragraphs.',
          'This is also what makes structural analysis possible at all — yours and a marker\'s. A paragraph whose point arrives in the sixth sentence reads as unstructured even when the thinking is good.'
        ]
      },
      {
        heading: 'Quote sparingly, paraphrase precisely',
        body: [
          'Quote when the exact wording is the evidence: a definition, a phrase you are going to analyse, a claim so contested that summarising it would be taking a side. Everywhere else, paraphrase — a quotation you did not need reads as padding, and long quotations are how essays hit a word count without saying anything.',
          'A paraphrase still needs a citation. Changing the words does not change whose idea it is, and this is the single most common way honest students commit plagiarism.'
        ]
      },
      {
        heading: 'Cite as you write, never afterwards',
        body: [
          'Reconstructing citations at the end is how the wrong page numbers get in, and it is the least interesting work in the process. Insert the marker when you write the sentence.',
          'Tracely will build the entry for you in APA, MLA or Chicago from the source metadata, and add it to the works-cited section in the same edit as the in-text marker — so one Ctrl+Z takes both back out if you change your mind.'
        ],
        note:
          'Author lists are truncated to "et al." after three authors. That is a simplification of the full style rules, not the complete APA/MLA/Chicago behaviour — check a long author list by hand if the marking is strict.'
      },
      {
        heading: 'Leave time to cut',
        body: [
          'The last pass is not proofreading. It is deleting the paragraph you liked that does not serve the argument, and writing the two sentences of warrant you skipped while drafting. Budget for it: an hour of cutting improves a grade more than an hour of new material almost every time.'
        ]
      }
    ]
  },
  {
    id: 'sources',
    title: 'Finding Credible Sources',
    blurb: 'Spot reliable evidence fast.',
    standfirst:
      'Credibility is not a property of a website. It is the fit between a specific claim and a specific piece of evidence — and some claims cannot be sourced at all.',
    readMinutes: 6,
    sections: [
      {
        heading: 'What Tracely searches, and what that means',
        body: [
          'Evidence search queries four scholarly indexes — OpenAlex, Crossref, Semantic Scholar and PubMed — with the World Bank added for statistical claims and Wikipedia for general facts. These are catalogues of published research. They are excellent for empirical claims and structurally blind to everything else.',
          'So a claim about your school\'s enrolment, a close reading of a line in a novel, a prediction about next year, or the text of a statute will come back with nothing. That is the index being silent, not the claim being false — and Tracely marks those as outside its index rather than unsupported, which are different accusations.'
        ]
      },
      {
        heading: 'Judge the fit, not the logo',
        body: [
          'A peer-reviewed paper that studied a different population is weaker evidence for your claim than a well-conducted government survey of exactly the population you are writing about. Ask what the source actually measured, in whom, and when — before asking how prestigious the venue is.',
          'The three questions that catch most problems: does the sample match the group my claim is about, is the date close enough for the thing I am claiming to still be true, and is the source reporting the finding or reporting on someone else reporting it.'
        ]
      },
      {
        heading: 'Encyclopaedias are a starting point with a bibliography',
        body: [
          'Wikipedia and Britannica are usually accurate on settled facts and are a fast route to the primary sources — which are at the bottom of the page. Follow them, read the actual study, and cite that.',
          'Where a general-reference source genuinely is the right citation — a definition, a date, an uncontroversial fact — cite it and move on. If your source agrees with your sentence, you do not need three more that also agree.'
        ]
      },
      {
        heading: 'Read the abstract, then the numbers',
        body: [
          'Abstracts overstate. The claim in an abstract is the strongest version the authors felt able to publish; the limitations section is where the real scope lives. If you are going to lean on a study, read what it says about its own sample size and what it explicitly did not test.',
          'A finding that "reached significance" is not the same as a finding that is large. If the effect size is small and you are writing "dramatically", the sentence is wrong even though the citation is real.'
        ]
      },
      {
        heading: 'Three sources that disagree beat five that agree',
        body: [
          'A bibliography where everything points the same way usually means the search was narrow, not that the question is settled. Deliberately look for the best work arguing the other side — it is where your counterargument paragraph comes from, and it is the difference between a literature review and a summary.'
        ]
      }
    ]
  }
]

export function guideById(id: string): Guide | null {
  return GUIDES.find((g) => g.id === id) ?? null
}
