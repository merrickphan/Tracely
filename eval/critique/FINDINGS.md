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

## Also fixed

`harness.ts` recorded `critique` and `verdict` but not `suggestedRevision` or
`citationFix` — the two fields that *decide* a verdict, since
`normalizeCritique` downgrades `overstated` to `weak` without a revision and
nulls `citationFix` on `fabricated`. The eval could not see the governing input
of the thing it was measuring. Both are recorded now.

## Caveat

8 claims, one run, one author of both the essays and the expectations. Enough to
establish that `fabricated` and `contradicted` do not fire where they plainly
should, and that correct sentences are being called weak. Not enough to put a
rate on any of it.
