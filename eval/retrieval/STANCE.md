# The stance model does not work, at any granularity — 2026-08-16

`support` carries the heaviest weight in `computeStrengthScore` (0.4) and has
contributed nothing since it was added: whole-abstract classification returned
`unclear` for all 21 sources it was asked about on the labelled baseline.

The plan of record was to replace `nli-deberta-v3-xsmall` with something
fine-tuned on SciFact. Before spending that, there was a cheaper hypothesis
written down in `eval/scripts/stance-sentence.mjs` — **and never run**. No
result for it exists anywhere in the repo.

> the granularity is wrong. NLI models are trained on short premise/hypothesis
> pairs, and SciFact pairs a claim with a single rationale SENTENCE. A
> 1000-character abstract spanning background, methods, results and limitations
> entails almost nothing in particular, so `neutral` is the honest answer.

It is a good hypothesis. It is also wrong.

## The measurement

`node eval/retrieval/stance.mjs` — 51 hand-labelled sources above the relevance
floor that carry an abstract, classified both ways with the shipping model and
the shipping thresholds.

```
                        n   supports  contradicts   unclear
  whole abstract       51          0            1        50
  sentence level       51          0            1        50
```

**Zero supports at either granularity.** Sentence-level splitting does not
rescue it, so the granularity hypothesis is closed and the model itself is the
problem — which is what the original plan said, now with evidence rather than
inference.

## The part that mattered more

Both decisive verdicts the model produces are **false contradictions, at 0.98
and 0.99** — far above `MIN_CONTRADICTION_CONFIDENCE` (0.8), so the confidence
bar is no protection at all.

```
  [labelled rel]  conf 0.99
    claim:    The Protestant Reformation depended on cheap pamphlets, and so did
              an enormous volume of witch-hunting literature.
    sentence: They included lengthy and complex productions, while some at least
              were written by authors with pretensions to learning.

  [labelled irr]  conf 0.98
    claim:    (the same claim)
    sentence: In 1727, an old woman from Loth in Sutherland was brought before a
              blazing fire in Dornoch.
```

The first is a source hand-labelled **relevant** for the claim it supposedly
contradicts. The second is a sentence of narrative prose that contradicts
nothing.

Follow one of those through production:

1. `stanceDecided` flips true, so `computeStrengthScore` switches to the
   with-stance weights, where `support` is 0.4 and evaluates to 0.
2. `contradicting >= supporting` is trivially true when nothing ever supports,
   so `CONTRADICTED_SCORE_CAP` floors the claim at 30.
3. `problemKind.ts` reports `contradicted-claim` — the second most severe kind
   it has, ranked above weak reasoning and every evidence finding, and the only
   one besides fabrication that asserts something is FALSE rather than
   unsupported.

**The only thing this model can currently do to a draft is take a well-evidenced
claim and tell a student it is factually wrong.** There is no offsetting upside,
because supports never fire.

## What changed

`STANCE_ENABLED = false` in `services/ml/index.ts`. `classifyStance` returns
`null`, which is the documented model-unavailable path, so scoring degrades to
the pre-stance weights — a state that has always been exercised and is now
pinned by `scoring.test.ts`.

Nothing is deleted. The worker, the protocol, the thresholds and the eval script
all stay. Flip the flag with a candidate model and `node
eval/retrieval/stance.mjs` prints the table above for it.

## What a replacement has to beat

A bar, so the next attempt is measured rather than assumed:

- **Supports must fire.** Any non-zero supports rate on `rel` sources is an
  improvement on today; a useful model should be well above its rate on `irr`.
- **No false contradiction above 0.8** on this set. Today's model produces two,
  and one is against relevant evidence.
- Candidates worth trying, in order: a SciFact-tuned entailment model, then
  scientific-domain NLI generally. `protocol.ts` already records that
  `ms-marco-MiniLM` was rejected for reranking because web-search training is
  out of distribution on academic claims — the same trap applies here.

## Caveat

51 sources, 13 claims, one labeller, labels not spot-checked
(`labels-2026-08-10.json`). Enough to justify turning a feature off that
produces zero true positives and two confident false ones; not enough to rank
candidate replacements finely. See the correction in FINDINGS.md.
