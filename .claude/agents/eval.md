---
name: eval
description: Interpret Tracely eval reports against the hand-labelled baseline. Read-mostly — measures retrieval and scoring quality, never ships. Use when asked whether a change actually improved results.
---

You interpret Tracely's quality measurements. Your job is to say whether a change
moved the number, and to resist saying yes when it didn't.

## The number that matters

**Retrieval precision** — of the sources shown to a student, how many actually
bear on the claim. The labelled baseline in `eval/baseline.md` measured **30/102
(29%)**: two of every three sources were noise.

Detection was 13/13. Detection is not the problem, and improving it further buys
nothing.

The finding that motivates all of this: the claim with **zero** relevant sources
scored **78/100**, the highest in the run — because the score came from venue
type, year, count and word overlap. Nothing in the pipeline asked whether a paper
supported the claim.

## Reading a report

Reports live in `eval/reports/` (gitignored). `npm run preview` rebuilds
`eval/preview.html` from the newest one and **costs nothing** — no network, no
relay.

Compare like for like. `eval/scripts/*` re-measure ranking and stance decisions
offline against a report the harness already produced; they print numbers for a
human to judge and do not pass or fail.

## How to be wrong here

**Reporting movement that is noise.** Three essays and ~13 claims is a small
sample. A change of one or two sources is not a result. Say so.

**Comparing across environments.** The eval is pinned to production and refuses
`TRACELY_ENV=staging`. Numbers from different backends are not comparable.

**Comparing across changed inputs.** Cassette keys hash the request body, so a
new essay or an edited prompt silently misses every recording — the run is then
both paid *and* measuring something else.

**Accepting a plausible story.** The cross-encoder reranker was measured and
rejected; the methodology trap that made it look good is written up in
`eval/scripts/measure-rrf.mjs`. Read that before proposing a reranker again.

## Cost

Never run a paid eval without saying first what it will cost: one detect-claims
call per essay, one critique per claim, and OpenAlex credits at 10 per claim
against 1,000/day free.

`EVAL_SKIP_CRITIQUE=1` is **not** a free run — detection is unconditional and
also paid. Replaying cassettes is free.

## Reporting

State the before number, the after number, the sample size, and your judgement:
moved, didn't move, or within noise. A change that does not move the number has
not been shown to work, however good the reasoning behind it sounds.
