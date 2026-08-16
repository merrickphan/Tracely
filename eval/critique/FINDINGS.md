# The critique, measured for the first time — 2026-08-16

The critique is the most expensive call in the product, the only thing that can
catch a fabricated citation, and until today **no eval had ever scored one**.
`eval/RUBRIC.md` is the source-labelling rubric (rel/marg/irr); there was no
grading standard for the critique at all.

8 claims across two essays chosen for their planted failures. Expectations in
`expected.json` were written before the run — `node eval/critique/score.mjs`.

```
  5/8 within the acceptable set

  the three verdicts that assert falsehood, not absence:
    fabricated     fired 0x   (acceptable on 2 claims)
    contradicted   fired 0x   (acceptable on 1 claim)
    overstated     fired 3x   (acceptable on 3 claims)
```

`overstated` works. It fired three times, correctly each time, and this is the
first time it has ever been observed — it was added to the type on 2026-08-15,
one day after the last critique-bearing eval run.

Three findings, worst first.

## 1. `fabricated` does not fire on the clearest possible case

08-C1 credits *"Ramirez and Doyle (2024)"* with finding a 23% improvement in
essay scores. **The study does not exist.** It carries every marker
`CRITIQUE_SYSTEM_PROMPT` itself lists: a plausible author pair, a round recent
year, a title that restates the claim it is attached to, an exact-sounding
figure with no methodology, and retrieval returned eight real on-topic papers
and not this one — which is the second half of the prompt's own Pass 2(c)
condition, satisfied.

Verdict: **`unsupported`**. The critique says why:

> The citation to Ramirez and Doyle (2024) cannot be verified as real or
> fabricated without further information, but nothing in the evidence titles or
> abstracts matches this reference.

The model declined to commit, which is exactly what the prompt asks for — *"if
you are unsure, you are in (b) or (a)"*, *"default hard toward (b)"*. The
asymmetry is right in principle: telling a student their real source is invented
is far worse than missing an invented one.

But the consequence is that `fabricated` requires a confidence the model will
almost never have, and `problemKind` ranks `fabricated-citation` **above every
other kind including a wrong fact**. On this evidence that entire severity tier
is unreachable, and the product's answer to an AI-hallucinated citation — the
failure a chatbot-assisted draft produces by default, and the one Tracely's
positioning is built on — is "unsupported", the same thing it says about a
sentence whose sources were merely thin.

The fix is not to lower the bar. It is that Pass 2(c) asks for the wrong
evidence: the model is asked to be confident a work does NOT exist, which is
unprovable from inside a model. What the pipeline actually has is a *retrieval*
answer — a focused search returned nothing matching this author, year and title
— and that is a fact about the world rather than about the model's memory.

## 2. `contradicted` still never fires, and the vocabulary collapses

05-C1 attributes to Orben & Przybylski (2019) the conclusion that social media
is a *primary driver* of declining teen wellbeing. That paper famously concluded
the opposite: the association is trivially small. The critique **identified this
correctly** —

> their main conclusion was that social media use has a small, statistically
> significant association with well-being, not that it is a primary driver […]
> The claim overstates their findings.

— and filed it as `overstated`, not `contradicted`.

Defensible, and it was in the acceptable set. But it collapses two different
problems into one label, and the labels are not interchangeable downstream:
`overstated` obliges a `suggestedRevision` that changes **only the quantifier or
hedge**. No hedge change can fix a sentence that reports the opposite of what its
source found. So the product offers to narrow a claim whose actual problem is
that it misreads the paper it cites.

## 3. Retrieval failure is reported as a reasoning failure

Two false positives, both on sentences that are correct.

05-C3 — *"Some researchers argue the effect is small."* True, properly hedged,
and exactly what the literature says. Verdict: **`unsupported`**, strength score
**0**. The critique's reason is explicit: *"None of the provided evidence items
directly address…"*.

05-C4 — the heterogeneity point — same story. The critique even concedes the
substance is *"a well-established principle in epidemiology and social science"*
and returns `unsupported` anyway, because the retrieved list did not contain it.

Then `problemKind` maps `unsupported` into `WEAK_VERDICTS`, which becomes
**`weak-reasoning`**. So the chain is:

> retrieval finds nothing → critique says unsupported → the card says
> **"Weak reasoning"** about a true, carefully hedged sentence.

Three layers each behaving reasonably, combining into an accusation. This is the
same coupling every measurement today has pointed at, now visible end to end,
and it is the most likely single cause of the product feeling untrustworthy in
ordinary use — unlike the fabricated-citation gap, it fires on *good* writing.

`unsupported` is doing two jobs: "the literature contradicts this" and "we did
not find anything". Only the first is a statement about the claim.

### Fixed — 2026-08-16

Split, on the discriminator the pipeline already computes: did anything clear
the relevance floor. `shared/problemKind.ts` gained `isRetrievalMiss`, and an
`unsupported` verdict reached with no relevant source no longer becomes
`weak-reasoning` — the retrieval kinds report the same state as "No supporting
sources", whose copy ends *"It may still be true — but you have nothing to cite
for it yet."* The verdict label follows in both cards: **No Evidence Found**,
and it stops counting toward "N issues found".

The relay is not asked, and its prompt is unchanged. From inside the critique
call, "no good evidence exists" and "no good evidence was handed to me" look
identical, so this is not a judgement the model is in a position to make.

Re-scored against the same report — no new relay calls, the inputs were already
recorded:

```
  unsupported verdicts: 5
    about the evidence read:  3
    about the search itself:  2   (0 relevant sources retrieved)

  correct sentences accused of a problem: 0/2   (was 2/2)
```

The 3 that survive are the right 3, and they include the Ramirez claim — it
retrieved six relevant papers and none of them is the study it names, so its
`unsupported` is a genuine finding about the evidence. Finding 1 is untouched by
this: that verdict should be `fabricated`, and it still is not.

The verdict-level score is unchanged at 5/8, deliberately. The relay still
answers `unsupported` for two sentences that are fine, and that miss is real —
it is a retrieval failure, and hiding it behind a downstream fix would lose the
only measurement pointing at it.

**A second bug fell out of this.** `nothingFound` was `count === 0`, and the two
call sites disagreed about what `count` meant: the document editor passed
`scoreBreakdown.sourceCount` (relevance-floored), while Screen Watch passed the
raw length of the returned list. Retrieval returns its top eight for every claim
whatever the topic, so in the overlay that test was effectively unreachable —
`no-sources` and `unverified-statistic` could not fire, and eight papers about
other subjects read as eight sources. Both call sites now ask
`hasRelevantSource(breakdown)`. The knock-on is that `cited-unverified` finally
obeys the rule its own comment states: it no longer accuses a cited sentence
when the search found nothing relevant.

## Also fixed

`harness.ts` recorded `critique` and `verdict` but not `suggestedRevision` or
`citationFix` — the two fields that *decide* a verdict, since
`normalizeCritique` downgrades `overstated` to `weak` without a revision and
nulls `citationFix` on `fabricated`. The eval could not see the governing input
of the thing it was measuring. Both are recorded now.

## Four more fabrications — 2026-08-16

The fabrication result rested on one planted reference caught twice, which is not
a rate. `eval/critique/essays/` adds two essays carrying four invented
author-pair citations and four real ones, each in a sentence written to be
detected as a claim. Expectations pre-registered in `expected.json` under batch
`2026-08-16-fabrication`; 10 live relay calls, production `3e14eb2`.

```
  7/8 within the acceptable set

  FABRICATION
    caught   3/4 invented citations named as fabricated
    HARM     0/4 real citations wrongly called fabricated
```

The two directions are counted apart on purpose. A fabricated citation reported
as something else under-warns the writer; a real citation reported as fabricated
tells them they invented a source they honestly cited. They are not exchangeable
at any rate, and averaging them would let a harm be paid for with a catch.

**The book control passed, and passed for the right reason.** Freakonomics cannot
be corroborated — Crossref does not carry trade books — so the critique received
an empty lookup for a genuine source, the exact case the prompt's caveat exists
to survive. It answered:

> Levitt and Dubner are the authors of the well-known book 'Freakonomics' (2005),
> which did argue that legalized abortion […] However, the claim that this
> explanation 'displaced policing and economic explanations' is overstated.

It named the work, which is what the naming requirement added a commit earlier
demands, and then judged the claim on its merits. The other three controls came
back `well-supported`. Zero harm across four.

**The miss is instructive.** Lindqvist and Oyelaran (2023) — invented, absent from
Crossref, in a sentence about congestion pricing where retrieval returns real
on-topic evaluations — came back `unsupported`:

> The reference lookup found no work by Lindqvist and Oyelaran (2023) in
> Crossref, but this does not prove fabrication…

The same hedge that produced the original Ramirez failure. But note where it
landed: `unsupported`, **not** `overstated`, and with no suggested revision. The
Pass 3 ban held, so the model under-warned instead of handing back a polished
sentence still crediting an invented study. The remaining failure is the mild one.

Standing at 4/5 caught and 0/8 harmed across both batches. Still small, and every
invented reference in the set was written by the same person who chose the query
strategy — the weakest joint in this measurement, and the one a genuinely
adversarial set would attack.

## Caveat

8 claims, one run, one author of both the essays and the expectations. Enough to
establish that `fabricated` and `contradicted` do not fire where they plainly
should, and that correct sentences are being called weak. Not enough to put a
rate on any of it.
