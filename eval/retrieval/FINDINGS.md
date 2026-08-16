# Retrieval — what is actually wrong, 2026-08-16

> **Update, same day — the set is now 36 claims, not 13.** Essays 04-09 had
> never been run or labelled; they are now (`labels/2026-08-16-essays-04-09.json`,
> 6 relay calls, 0 OpenAlex credits). Every headline below moved, and the section
> after this one is the current picture. The 13-claim numbers are kept as
> written because the correction they carry is the point.

## The 36-claim picture

```
  strict precision           51/288   18%
  claims with >=1 relevant   22/36    61%
  ...of the ANSWERABLE ones  22/25    88%
  ...with it ranked 1st      15/22    68%
  ...within the top 3        21/22    95%
  MRR (of those found)        0.81
```

**The denominator was the problem with "61%".** Eleven of the fourteen claims
that retrieved nothing relevant are claims no literature can settle as phrased,
and they are now marked `answerable: false`:

- unfalsifiable predictions — *"depression rates will double within the next
  decade"*, *"routine surgery will become impossible"*
- facts about a text rather than the world — *"the moment of animation takes up
  barely a paragraph"*
- one local council's vote, and one town's rents
- **a fabricated citation** — 08-C1's *"Ramirez and Doyle (2024)"* does not exist

**All eleven returned zero relevant sources, which is the correct answer.** Among
claims that literature can actually speak to, retrieval finds something for 88%
and puts it in the top three 95% of the time.

Two headlines got worse with more data, as they should:

| | 13 claims | 36 claims |
|---|---|---|
| relevant source ranked 1st | 80% | **68%** |
| score correlation, before → after | 0.31 → 0.54 | **0.35 → 0.38** |

Essays 01-03 were easier than the rest. The scoring fix still helps and helps
less than the small set suggested — which is exactly what the robustness section
below predicted would happen.

**The residual defect is unchanged and now better measured.** Mean score for a
claim with no relevant sources is **60.4**, and the dilution fix does not move it
(60.4 before, 60.4 after), because those sources clear the 0.42 floor while
being marginal rather than irrelevant. A claim nothing supports lands mid-band
and is reported as partially supported. That includes the fabricated citation:
the evidence pipeline alone cannot tell an invented study from a poorly-retrieved
real one, and only the critique's `fabricated` verdict can.



`eval/baseline.md` and the 08-09 re-run both concluded **"detection is fine,
retrieval is the bottleneck"**, from a strict precision of 22-29% that did not
move across ~35 commits of retrieval work.

Re-measured against the same claims with two metrics nobody had computed, that
conclusion does not survive. Precision is real, and it is measuring something
the product never asks about.

```
  strict precision           24/104   23%      <- the number we have been steering by
  claims with >=1 relevant   10/13    77%
  ...with it ranked 1st       8/10    80%
  ...within the top 3        10/10   100%
  MRR (of those found)        0.87
```

**Retrieval finds the evidence, and ranking puts it first.** Of the three claims
that got nothing, two are unfalsifiable as phrased ("depression rates will double
within the next decade", "remote workers are less likely to be promoted") and the
third is a three-limbed claim about the alphabet, paper industry and merchant
class. No ranking or corpus change reaches those.

Labels: `labels-2026-08-10.json`, 104 sources, by Claude against
`eval/baseline.md`'s rubric, **not yet spot-checked**. Where they overlap the
baseline's own labelling of the earlier run they agree source-for-source, which
is the only calibration check available.

## The real defect was in scoring, and it inverted the measure

`quality`, `recency` and `relevance` were plain averages over all eight scored
sources. Only `sourceCount` applied the relevance floor. Retrieval returns about
two relevant sources in eight, and the six behind them are typically *recent
journal articles about something else* — so they scored 1.0 on venue tier and
near 1.0 on recency, and the score was mostly a report on papers that had nothing
to do with the claim.

```
  mean strength score, by relevant sources actually retrieved
                        before    after
    0 relevant           60.3      58.0
    1-2 relevant         71.0      67.7
    3+ relevant          58.7      73.3
  rank correlation        0.31      0.54
```

Before the fix, **a claim with three or more genuinely supporting papers scored
lower than a claim with none.** The highest score in the run (81) went to a claim
with one relevant source; a claim with five scored 68, exactly level with an
unfalsifiable prediction that retrieved nothing.

`problemKind.ts` reads this number to decide what to tell the writer. "Well
supported" and "nothing found" were arriving at the same verdict, which is a
complete account of why the product's judgements read as arbitrary — and it was
never a retrieval failure.

## Correction — the band evidence above is weaker than it reads

Added 2026-08-16 after a robustness pass (`node eval/retrieval/robustness.mjs`).
The numbers above are as measured; the weight put on them was too high, and the
paragraph beginning "Before the fix" overstates what 13 claims can support.

Re-run under a second defensible labelling — Wikipedia demoted from `rel` to
`marg` for general historical claims, and 01-C4's sources demoted because none
of them establish the *primacy* its claim asserts:

```
                        as labelled            strict
  0 relevant         60.3 -> 58.0         52.8 -> 63.5
  1-2 relevant       71.0 -> 67.7         71.0 -> 67.7
  3+ relevant        58.7 -> 73.3         73.0 -> 70.0
```

**Under the strict labelling the before-fix bands are already monotonic.** The
inversion is carried almost entirely by 01-C4, which had three sources labelled
relevant and the lowest score in the run (30) — and whose claim is overreaching
in a way the critique separately caught. Move that one claim and the headline
finding of this document weakens to a shrug.

What survives, and what does not:

| | |
|---|---|
| the 0.42 floor | **robust** — every relevant source clears it under both labellings |
| retrieval finds evidence for most claims | **robust** — 77% / 69% |
| relevant source ranked 1st | **fragile** — 80% / 56%, swinging on the Wikipedia call alone |
| the score inversion | **fragile** — one claim carries it |

The scoring fix itself still stands, on the mechanism rather than on these bands:
averaging venue tier and publication year over six irrelevant papers is wrong
whatever the labels say, and `scoring.test.ts` demonstrates it deterministically
with no labels involved. But **"a claim with three supporting papers scored below
one with none" should not be repeated as a finding** — it is one labelled claim,
by one labeller, at n=13.

The honest read of this whole directory is that it is enough evidence to justify
a floor and a formula change, and nowhere near enough to make quantitative claims
about how good the score now is.

## The floor was never calibrated, and the code said so

`MIN_COUNTABLE_RELEVANCE.dense` was 0.35, documented in place as "a starting
point from four labelled pairs, not a calibration ... meant to be moved by what
the eval reports". This is that calibration, on 104 pairs.

The embedding signal is good — **AUC 0.905** separating relevant from irrelevant.
The threshold was simply in the wrong place:

```
  floor   rel kept   irrelevant admitted
  0.350     24/24         29/44
  0.400     24/24         25/44
  0.425     24/24         17/44
  0.500     18/24         10/44
  0.600     13/24          0/44
```

0.42 is the last point that costs nothing: every relevant source kept, 41% of
the irrelevant ones gone. Past it, precision is bought with real evidence, and a
dropped relevant source tells a well-supported claim it has no support.

Fitted to the minimum of 24 observations by one labeller — a calibration, not a
constant. Re-run the sweep when labels are added.

## What is left, and it is one thing

The 0-relevant band still scores 58 rather than near zero, because those claims
retrieve sources that clear 0.42 and are still not evidence. Dense similarity
separates relevant from **irrelevant** at 0.905 and relevant from **marginal**
much worse — means of 0.59 against 0.51, heavily overlapping. No threshold fixes
that, because it is a different question:

> *is this source about the same topic* — which embeddings answer well
> *is this source evidence for this claim* — which they cannot answer at all

That second question is exactly what the stance/NLI model exists for, and it
returns `unclear` for everything it is asked (21 of 21 on the labelled baseline).
`support` carries the heaviest weight in the formula, 0.4, and contributes
nothing today.

**So the next piece of retrieval work is not retrieval.** It is replacing
`nli-deberta-v3-xsmall` with something fine-tuned on SciFact, and it is the only
remaining lever on this evidence.

## Not done

- **The 70/40 bands in `problemKind.ts` were calibrated against the old score
  distribution** and have not been re-derived against the new one. The direction
  is right — well-evidenced claims move up, unevidenced ones move down — but
  which band a claim lands in has shifted and nothing has measured where.
- **`MIN_CRITIQUE_RELEVANCE` (0.15) is untouched.** It gates what the reasoning
  model is shown and predates the dense metric entirely; the same sweep should be
  run for it.
- **The labels are one pass by one labeller and are not spot-checked.**
