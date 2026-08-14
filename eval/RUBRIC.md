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

## The case this rubric does not settle

**Compound sentences.** Several claims in the set assert two things at once —
04-energy-access C3 carries both a transmission-loss statistic and an
unevidenced assertion about utility revenue. A source that nails one half and
is silent on the other has no obvious label, and the ladder above does not
decide it.

The provisional rule used in the 04–06 annotations is: **label against the half
the retrieval query was built from, and note the split.** It is provisional
because it is a decision, not a derivation, and it should be settled
deliberately rather than by whoever labels next. Until then it is at least
recorded, which is more than the rel/marg boundary had.

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
