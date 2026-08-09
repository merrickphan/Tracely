---
description: Run the retrieval-quality eval, reporting cost before spending
---

Run the offline quality harness over `eval/essays` and report the numbers against
the hand labels in `eval/baseline.md`.

## This costs real money

A run makes one paid detect-claims call per essay, one paid critique per claim,
and spends OpenAlex credits at 10 per claim against a 1,000/day free allowance.
Seven runs in one morning is most of a day's credits and a visible line on the
bill.

**Before running, state what it will cost**: how many essays, roughly how many
claims, whether cassettes exist to replay, and therefore whether this run spends
anything at all. Then let the user decide.

## Free vs paid

```bash
# Free — replays recorded responses, touches no network
npm run evaluate

# Paid — retrieval and scoring only, still pays for detection
EVAL_ALLOW_SPEND=1 EVAL_SKIP_CRITIQUE=1 npm run evaluate

# Paid — everything, including critique
EVAL_ALLOW_SPEND=1 npm run evaluate

# Free — rebuild the HTML report from the newest existing run
npm run preview
```

`EVAL_SKIP_CRITIQUE` is not a free run. Detection is unconditional and is also a
paid call.

## Cassettes

Recorded responses live under `out/eval/cassettes/<environment>/`. The spend
guard only demands `EVAL_ALLOW_SPEND` when a run can actually spend, and it
decides that by counting recordings — which is why they are namespaced per
environment. Cassette keys hash the request URL, so a different relay host
invalidates every relay recording at once; a shared directory would keep counting
the old environment's files and wave through a fully paid run.

The eval is pinned to production and refuses to run with `TRACELY_ENV=staging`.
Its numbers are only comparable across runs if the backend behind them never
moves.

## Reporting

The number that matters is **retrieval precision** — how many of the sources
shown to a student are actually relevant. The baseline was 30/102 (29%).

Compare against `eval/baseline.md` and say whether the change moved it, did not
move it, or moved it within noise. A change that does not move the number has not
been shown to work, however reasonable it sounds.
