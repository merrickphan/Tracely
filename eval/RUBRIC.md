# Labelling rubric — rel / marg / irr

The decision procedure for labelling one retrieved source against one claim.
Read this before opening a `label-review-NN.md`.

## Why this file exists

`eval/rerun-2026-08-09.md` reports strict retrieval precision at 29% in the
baseline and 22% in the re-run, and then says the honest thing about it:

> Both sets of labels are mine from different sessions, and the rel/marg
> boundary is exactly where that drifts — the marginal column moved the
> opposite way by a similar amount, which is what relabelling drift looks like.

That is the whole problem. Seven points of apparent regression, in a set of 102
sources, produced by one person applying an unwritten rule twice. Every
retrieval decision downstream is judged against these labels, so the boundary
being in someone's head rather than on paper caps how small an improvement can
ever be detected.

Nothing here is new policy. It is the rule already visible in
`eval/label-review-01.md`, written down so the second labelling session agrees
with the first.

## The ladder

Ask these in order. Stop at the first one that answers.

**1. Is this source about the claim's topic, at the claim's specificity?**
No → **`irr`**.

Judge the topic at the level the sentence is pitched, not one level up. In
`label-review-01.md`, *Sleep is essential to health: an American Academy of
Sleep Medicine position statement* is labelled `irr` against a claim about
school start times. Sleep is the subject matter one level up; the claim is
about when schools begin. Adjacency is not topicality.

**2. Does this source address the specific proposition the sentence asserts?**
No → **`marg`**.

This is the line that drifts, and it is the one worth being mechanical about.
A paper can be squarely, unambiguously on topic and still evidence a *different
proposition* about that topic.

The clearest case in the existing labels, all against claim 1.1 — *the AAP
recommended in 2014 that schools start no earlier than 8:30, yet most US high
schools still begin before that*:

| source | label | why |
|---|---|---|
| *School Start Times for Middle School and High School Students — US, 2011–12* | `rel` | measures the prevalence the sentence asserts |
| *Later School Start Time Is Associated with Improved Sleep and Daytime Functioning* | `marg` | studies an **effect** of later start times |
| *40.4 School Start Time Change: Where Are We Now?* | `marg` | same topic, surveys **change over time** |
| *School Start Time and Sleepy Teens* | `marg` | same topic, argues a **consequence** |

All four are about school start times. One reports the fact claimed; three
report something else true about the same subject. **A paper about the effects
of X does not evidence a claim about the prevalence of X.**

**3. Otherwise → `rel`.**

### Scale is part of specificity

*Added 2026-08-15 with essays 07–09, and not yet reviewed. It is an extension of
question 1's existing wording rather than a new rule, but say so if you disagree
— it decides most of the labels in `09-parking-minimums`.*

Question 1 says "at the claim's specificity", and geographic scale is the case
where that bites hardest, because a national source answering a local claim
looks like a good answer. Two situations that feel the same and are not:

| the claim | the source | label | why |
|---|---|---|---|
| *our council voted last year to remove parking minimums* | a study of parking reform in several US cities | `marg` | same topic, same specificity (city policy), **different proposition** — it reports effects elsewhere, not what this council did |
| *the vacancy rate downtown has been under two percent* | a national urban housing series | `irr` | the number **is** the topic, and a national number is not a local one. One level up, exactly like the AASM sleep statement against a school-start-times claim |

The test: if the sentence asserts a *measurement*, a source measuring something
else's version of it fails question 1 and never reaches question 2. If the
sentence asserts a *fact about a policy or event*, a source about the same kind
of policy passes question 1 and is decided at question 2 — nearly always `marg`.

## Two demotions

**A source you cannot read past the title is `marg` at best.**

Of the eight sources under claim 1, four were matched on title alone with no
abstract. Not one of them was labelled `rel`; three went `marg`, one `irr`. The
only `rel` came with an abstract. That is not a coincidence and it should be the
default: without the abstract you are guessing what the paper concluded, and a
guess in the ground truth is worse than a conservative label. Promote to `rel`
only if the title alone states the proposition — some do.

**Right entity, wrong sense of the word, is `irr` — never `marg`.**

`rerun-2026-08-09.md` lists these, all still present:

- "visibility" → *Lancet Global Health Commission on Global Eye Health*
- "existed … before" → *DNA could have existed long before life itself*
- "next decade" → *Need for home economics teachers in Iowa's public schools*
- "remote" → *Remote Agent: to boldly go where no AI system has gone before*

These are lexical collisions. They fail question 1, so they never reach the
`marg` question. Filing them as `marg` because a shared word makes them feel
adjacent is what inflates the marginal column while strict precision stays
flat — visible in the re-run, where marginal rose 11 points as strict fell 7.

## The cases this rubric does not settle

**A citation to a source that does not exist. — SETTLED 2026-08-15.** A
`fabricated` verdict now exists and `08-ai-grading` uses it. Merrick's call,
made after reviewing 30 labelled candidate sentences; the reasoning and the
alternative that was rejected are both below, because a decision recorded
without its alternative is indistinguishable from a default.

Validation requires `citedSource.searchedFor` — the mirror of `miscited`'s
`citedSource.says`. Whichever half of the pair carries the finding has to be
written down, or the label is an accusation rather than a finding. In the
product this maps to the `fabricated-citation` problem kind, which sorts above
`contradicted-claim` and is deliberately phrased "Source not found — may be
fabricated": four academic indexes do not hold every real source, so the
defensible claim is that Tracely could not find it.

What follows is the argument as it stood before the decision, kept because it
is the case against.

`08-ai-grading` cites *Ramirez and Doyle (2024)*, which is invented — written
to look exactly like what a chatbot produces. There was no verdict for it.

`miscited` is the natural label and validation rejects it, correctly: it
requires `citedSource.says`, and a source that does not exist says nothing. What
is left is `unsupported`, which reads *"nothing found either way; may still be
true"* — far too generous for a fabricated reference, and it puts the most
serious thing a draft can do in the same bucket as a claim nobody has studied
yet. The annotation is filed as `unsupported` with the gap written on it.

This is a decision, not a derivation: a new verdict changes what every
downstream fit is measuring, and `05-social-media` versus `08-ai-grading` is now
the pair that shows why the distinction matters — real-source-wrong-claim and
no-source-at-all produce identical retrieval behaviour and are not the same
mistake.

**Two claims moved from `unsupported` to `fabricated`, so any fit computed
before 2026-08-15 is measuring a different label set.** Both are in
`08-ai-grading`; nothing else in the corpus changed. Re-run rather than compare
across the boundary — this is precisely the relabelling drift this file was
written to prevent, and it is only safe because it is written down here.

**Compound sentences.** Several claims in the set assert two things at once —
04-energy-access C3 carries both a transmission-loss statistic and an
unevidenced assertion about utility revenue. A source that nails one half and
is silent on the other has no obvious label, and the ladder above does not
decide it.

`07-antibiotic-resistance` C3 is the cleanest instance yet and was added for
this: the first half is a real published figure (~30% of US outpatient
antibiotic prescriptions unnecessary) and the second half is an unevidenced
causal leap about hospital infections. It will score well on sources while its
actual assertion goes unevidenced, which is the cost of the provisional rule
made visible.

The provisional rule used in the 04–12 annotations is: **label against the half
the retrieval query was built from, and note the split.** It is provisional
because it is a decision, not a derivation, and it should be settled
deliberately rather than by whoever labels next. Until then it is at least
recorded, which is more than the rel/marg boundary had.

**A source that addresses the proposition and is wrong. — OPEN, raised
2026-08-15 with essay 11.** The ladder has three rungs and none of them asks
whether a source is still believed. Walk `11-debt-threshold` C1 — *Reinhart and
Rogoff found that when a country's public debt passes ninety percent of GDP,
average growth falls sharply* — down it, against the 2010 paper itself:

1. On topic, at the claim's specificity. Not `irr`.
2. Addresses the exact proposition the sentence asserts. Not `marg`.
3. Therefore **`rel`**.

That is the right answer to the question the ladder asks and the wrong answer to
the question the product asks, because the result did not survive reanalysis
(Herndon, Ash and Pollin, 2014). Worse, every factor `computeStrengthScore`
reads points the same way: a top-venue paper with an enormous citation count
ranks first and lifts the strength score, so the claim would be reported as
*better* evidenced than the sentence next to it that describes the refutation.
**A refuted source is the highest-scoring possible answer under the current
rules.**

Three things are tangled here and only the first is a labelling question:

- **`rel` may be the honest label.** The label describes retrieval — this source
  *is* what the claim is about — and overloading it with "and it is true" would
  put the annotator's view of the literature into a column that measures
  whether search found the right paper. Recording it somewhere else keeps the
  two measurements separable.
- **The claim verdict has no fit either.** `contradicted` is the nearest and is
  what `11-debt-threshold` uses, with the reasoning on the row. But
  `contradicted` reads as *the student picked up something the literature
  disagrees with*, and here the student picked up a specific paper that agrees
  with them. `miscited` is excluded by construction (it requires a gap between
  sentence and source; there is none) and `unsupported` is wrong the same way it
  was wrong for `08-ai-grading` before `fabricated` existed. Whether this needs
  its own verdict is Merrick's call, exactly as `fabricated` was — **do not add
  one on an agent's say-so.**
- **It may not be a labelling problem at all.** Crossref publishes retraction
  and correction relationships, and this is the shape of claim a citing-context
  or stance signal would catch. Recording it here rather than fixing it is
  deliberate; the instrument comes first.

Adjacent and not the same: a source that is merely *old*. Recency is already a
scoring factor. This is about a specific published disagreement, not about age.

**Non-English sources, and the title-only demotion. — Extends an existing rule,
added 2026-08-15 with essay 12.** `12-apprenticeships` asks about the German
dual system, whose primary literature is largely German-language. Two
consequences, and the second is the one that could go wrong quietly:

- A German-language record that genuinely evidences the claim is `rel`. Language
  is not topicality and the ladder never mentions it.
- **But a record whose title and abstract you cannot read is `marg` at best**,
  by the demotion already written above — *"without the abstract you are
  guessing what the paper concluded, and a guess in the ground truth is worse
  than a conservative label."* An unreadable title is the same situation as a
  missing one, for the same reason, and an annotator who reads no German is in
  exactly that position. Applying it here is an extension of the existing rule
  rather than a new one; say so if you disagree.

The risk this creates is worth naming: it will make a language the pipeline
never queries look, in the labels, like a language with no good sources in it.
That is a limit of the annotator, not a finding about coverage, and any
conclusion drawn from `12-apprenticeships` about non-English retrieval has to
carry it.

## Practical notes

- Label the sentence **as phrased**, not as the student meant it. `unsupported`
  exists for claims nothing can support as written; do not rescue a sentence by
  labelling a source `rel` for the claim it should have made.
- Disagreeing with an earlier label is fine — **say so in the file** rather than
  silently overwriting. A relabel that nobody records is indistinguishable from
  a retrieval regression, which is exactly the ambiguity that produced the 29%
  → 22% confusion.
- One annotator means one idiolect. `eval/annotations/README.md` already says
  this. The rubric narrows the drift; it does not make the labels general.
