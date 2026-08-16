# Making `fabricated` reachable — 2026-08-16

`fabricated` is the top severity tier in `problemKind.ts`, ranked above a wrong
fact, and it has **never fired once**. eval/critique/FINDINGS.md finding 1: shown
a sentence crediting "Ramirez and Doyle (2024)" with an exact figure — a study
that does not exist, carrying every marker the relay's own prompt lists — the
critique returned `unsupported` and explained itself:

> cannot be verified as real or fabricated without further information

That is the correct answer to the question it was asked. Pass 2(c) required the
model to be *"confident no work matching this author, year and title exists"*,
and a model cannot be confident of a negative about the world. The verdict was
unreachable by construction, so Tracely's answer to an AI-hallucinated citation
was the same word it uses for thin sourcing — and the failure a chatbot-assisted
draft produces by default is the one this product's positioning is built on.

**The fix is not a firmer prompt. It is to stop asking the model and go and
look.** A targeted query for the author and year the sentence names is a fact
about the world rather than about the model's memory, and it is cheap: Crossref
is free and unmetered.

`node eval/fabrication/run.mjs`

## It separates cleanly

```
  DETECTION   10/10  invented author pairs not corroborated
  FALSE ALARM  2/24  real references not corroborated
                 article  0/16
                 book     2/8
```

Labels in `references.json` were written from knowledge of the literature, never
from a Crossref result — labelling a reference "real" because Crossref returned
it would be measuring the index against itself. The invented pairs are
constructed, because there is no corpus of known-hallucinated citations to draw
on; the real ones are works most people who took the undergraduate course could
name, spread from 1974 to 2019.

Three design decisions did the work, and each came from a failure in this run.

## 1. Two authors, or no check at all

A single surname corroborates on a coincidence. "Dunster 2018" returns a paper
on blood coagulation; "Barrero 2023" a Spanish article on public procurement.
Both cited references are real, and both were "corroborated" by works that have
nothing to do with them — which means an *invented* single-author reference
would be corroborated exactly as readily. The check has no power there.

So `isCheckable` requires two named surnames. A work carrying **both** cited
names in the cited year is not something a common surname produces by chance.

The cost is stated rather than hidden: an invented single-author citation cannot
be caught by this at all, and `et al.` names exactly one surname however many it
hides. In the 16-essay corpus that leaves 5 of 12 references checkable. What is
bought is that the check cannot manufacture an accusation out of a common name.

## 2. Two queries, because they fail in opposite directions

Corroboration is an existence proof, so looking twice can only reduce false
accusations — it cannot manufacture one, since both queries still have to clear
the same authors-and-year test.

| query | rescues | fails |
|---|---|---|
| surnames + year + the sentence's words | `Wheaton Ferro 2016` alone returns twenty petroleum-engineering and lifestyle-sport papers, not the cited one | — |
| surnames + year alone | — | the sentence "students **typed** them on laptops" turned a query for the most cited note-taking study in psychology into twenty papers on **typed lambda calculus** |

Each alone produced a false alarm on a famous, real paper. Together: 0/16 on
articles.

## 3. The lookup may not reach a verdict on its own

The article set came back 0/16 and looked conclusive. Books were added
afterwards precisely because that set could not see the gap, and they found it:

```
  NOT FOUND  Levitt & Dubner 2005   (Freakonomics)
  NOT FOUND  Strunk & White 2000    (The Elements of Style)
```

Crossref registers DOIs for the scholarly record. It does not carry most trade
books, most government and NGO reports, or most non-English work — and a student
citing any of those is doing nothing wrong. A quarter of real two-author books
uncorroborated is not a rate anything may act on alone.

So what ships is the **evidence**, handed to the one reader that can tell a
missing book from a missing paper. `describeReferenceChecks` writes what was
done and what came back, never a conclusion, and says so in the line itself:

> a targeted search of Crossref for a work by Ramirez and Doyle 2024 returned 20
> results and none of them lists all of these authors. Crossref does not index
> most books, government and NGO reports, or non-English work, so this is not by
> itself proof the source does not exist.

Relay Pass 2(c) now reads: the lookup section is present, it found nothing, AND
the reference carries the marks of generation. Absent the section, (c) is
unavailable — no lookup happened, which the prompt is explicit is a different
thing from a lookup that found nothing.

## What this still cannot do

- **Single-author and `et al.` references.** No check. See §1.
- **Numeric and MLA author-page styles.** `[3]` and `(Shoup 45)` carry no year
  and are not parsed at all, so an IEEE or MLA draft gets no fabrication check
  whatsoever. That is a large fraction of real student writing.
- **Institutions and quoted titles.** Excluded deliberately; a scholarly index
  answers them badly and "not found" would carry no information.
- **A real paper misdescribed.** Out of scope by design — `corroborate` is blind
  to topic, so a reference that resolves to a real work saying something else
  corroborates. That is a different problem with different verdicts, and
  reporting it as an invented citation would be the more serious of the two
  accusations and the wrong repair entirely.

## Deployed and run against production — 2026-08-16

The lookup reaches the model and the model uses it. Both live critiques in the
production run name it unprompted: *"Evidence 2 and the reference lookup confirm
the study exists"*, and *"The reference lookup found no work by Ramirez and Doyle
(2024) in Crossref"*. The wiring is verified end to end.

**The verdict is not stable.** Probed in isolation, the Ramirez claim returns
`fabricated`, with the lookup quoted as the reason. In the full pipeline — real
retrieved evidence, real abstracts, a strength score of 80 — the same reference
returns `overstated`:

> The reference lookup found no work by Ramirez and Doyle (2024) in Crossref, but
> this is not definitive proof of fabrication, as the work could be a book,
> report, or non-indexed source.

That is the caveat this prompt deliberately added, applied where it does not fit:
the sentence cites a *study* with a percentage and a sample, not a book. n=1 in
each direction, so what is established is that both outcomes are reachable for the
same reference, not a rate.

**`overstated` is a bad place for a suspected fabrication to land**, and worse
than the `unsupported` it used to get. The verdict obliges a hedge-only revision,
so the product offered:

> Ramirez and Doyle (2024) found that students who received AI-generated feedback
> improved their essay scores over a single semester…

— a rewritten sentence that still credits a study that does not exist. Softening
the number is the wrong repair when the problem is the source.

Two candidate fixes, neither tried: shorten the book caveat and tie it to the
kind of work the sentence actually describes, or forbid `overstated` outright
when the lookup came back empty, so the fall-through is `unsupported` rather than
a polished citation to nothing.

### The run itself is only two-thirds current

6 of the 8 critiques replayed from cassettes recorded under the **previous**
prompt — their request bodies are unchanged, because only the two claims with
checkable references carry a `referenceCheck` field. Only those two were live.
The other six are not evidence about the new prompt either way.

### Two measurement hazards, found the expensive way

**The staging alias was stale.** `tracely-relay-staging.vercel.app` served a
deployment from 2026-08-09 while newer commits built and went READY behind it.
An 8-call run against "staging" tested a build from a week earlier, and the
README's `merge --ff-only staging` invariant — production cannot contain a commit
staging never ran — had been quietly false for two promotions.

**The eval's scratch profile was not namespaced by environment.** Cassettes are,
for a reason written down in `scripts/evaluate.mjs`; the SQLite profile holding
the `ai:critique` cache was not. That cache keys on the request, not the relay
host, because a shipped build has `RELAY_URL` compiled in and can never talk to a
second relay — but the eval can. So a staging run populated it and the next
production run answered every claim from staging's cache, made **zero** relay
calls, and reported the old build's verdicts as production's. It looked like a
clean free re-run. `dataDir` is now `out/eval/data/<env>`.

Both reports are kept as `.stale-staging-build` and `.stale-cache` rather than
deleted, since `eval:critique` picks the newest critique-bearing report and would
otherwise have scored against them.

## `fabricated` fires — and something else broke

10 live relay calls, production, `5f982c0`. Relay cassettes archived and the
scratch profile cleared first, so all 8 critiques are genuinely current.

```
  fabricated     fired 1x   (acceptable on 2)
  contradicted   fired 1x   (acceptable on 1)
  overstated     fired 3x   (acceptable on 3)

  correct sentences accused of a problem: 0/2
```

All three truth verdicts fire for the first time. The headline test passes, and
the output is exactly what the verdict is supposed to look like:

> No well-known study by Ramirez and Doyle (2024) is recognized, and a targeted
> Crossref search found no such work by these authors in 2024. The reference reads
> as generated: plausible author pair, round recent year, and a precise effect
> size that matches the claim.

`suggestedRevision: null`, `citationFix: null`. The laundering is gone.

**But the run also produced a false `contradicted`.** 08-C3 — *"GPT-5 class models
now score above the median human rater"* — was pre-registered as the control for
exactly this, and it moved the wrong way:

> As of my knowledge cutoff in June 2024, GPT-5 has not been publicly released or
> evaluated in peer-reviewed literature […] Thus, the claim is contradicted on the
> specific point about GPT-5.

The model treated its own training cutoff as evidence the world does not contain
the thing. That is the same error Pass 2(c) was rewritten to remove — "I do not
recognise it" standing in for "it does not exist" — reappearing one pass earlier,
where the Crossref lookup cannot reach it. Pass 1 already warns against this in
its own words; it did not hold.

Two runs of this claim under the previous prompt returned `unsupported`, so the
change is where suspicion belongs. The most likely mechanism is spillover: the new
Pass 2 language ("an empty lookup forces a decision, and 'it could be a book' is
not one") reads as a general instruction to commit, and Pass 1 committed. n=1, and
the fix that removed one overreach appears to have created another.

`contradicted-claim` is the second-highest severity in `problemKind.ts`, and the
card reads **"Contradicted — check this fact"** on a claim about a recent model
that may well be true. The symmetric repair is to give Pass 1 the guard Pass 2 now
has: a knowledge cutoff is not evidence about the world, and a claim about
something more recent than the cutoff falls through to Pass 2/3 rather than
becoming a contradiction. Not yet made.

## Pass 1 guard — the false contradiction is gone

Production `3e14eb2`, 10 live calls.

```
  fabricated     fired 1x   (acceptable on 2)
  contradicted   fired 0x   (acceptable on 1)
  overstated     fired 5x   (acceptable on 3)
```

08-C3 moved from `contradicted` to `overstated`. The claim about a model newer
than the critique's training data is no longer called false, which was the point.
`fabricated` held on the headline test across both runs — two for two, the only
thing here measured more than once.

**`overstated` is now the catch-all.** Five fires where three are defensible. The
verdict that was unreachable two days ago is now the answer to anything the model
will not commit on, which is the same shape of problem as `unsupported` was before
the retrieval split: one label absorbing several findings. Milder than a false
contradiction, and worth watching rather than acting on at n=1.

### The claim set changed under the run

Only 7 of the 8 pre-registered claims were scored. Detection re-ran live — I had
cleared every `relay-*.json` cassette, which includes `detect-claims` — and
returned a different set for essay 05: *"Some researchers argue the effect is
small"*, the control for false positives on correct writing, was not detected this
time, and a different sentence was.

So detection is not stable across re-runs despite `temperature: 0`, and the
`correct sentences accused: 0/2` line is really 0/1 on this run, with the other
control absent rather than passing. Comparisons across these three runs are not
strictly like-for-like.

The procedural fix is narrow: clear only the **critique** relay cassettes between
prompt changes, never the detection ones. Holding the detected claim set fixed is
what makes two critique runs comparable at all.

## Caveat

24 real references and 10 invented ones, one index, one labeller who wrote both
the invented set and the labels. Enough to establish that the separation exists
and that books break it; not enough for a rate. The invented pairs were
constructed by the same person who chose the query strategy, which is the
weakest part of this: a fabrication that happens to share a surname pair with a
real indexed work would be corroborated, and nothing here samples that.
