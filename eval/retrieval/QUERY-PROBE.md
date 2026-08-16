# Rescuing 05-C4 with the search query as a second probe — tried, reverted

**2026-08-16. Not shipped.** Recorded because the idea is a natural one, the
reasoning behind it was sound, and the measurement said no in a way that is
worth not rediscovering.

## The failure it was aimed at

05-C4 — *"But small average effects can hide large effects in vulnerable
subgroups, and anyone who has watched a fourteen-year-old scroll for four hours
straight knows what they are looking at"* — scores **0**, returns `unsupported`,
and is the last failure in the critique suite.

Retrieval is not the problem. It found the right papers:

```
rel=0.351  Small effects, big questions: the unfinished business of social me…
rel=0.243  Can Variation in Subgroups' Average Treatment Effects Explain Trea…
```

Both sit under `MIN_COUNTABLE_RELEVANCE.dense = 0.42`, so `sourceCount` is 0 and
the claim reads as having no support at all.

The diagnosis: relevance is `cosine(claimText, source)`, and half this claim is
anecdote. The embedding carries the fourteen-year-old as much as the
proposition, which drags every genuine match down.

## The idea

`searchQuery` is the relay's own distillation of what the sentence is asking —
already computed, free of the anecdote. Score each source as
`max(cos(claim, src), cos(query, src))`: the claim stays the primary signal, the
query rescues a sentence whose prose buries its proposition. One extra text in a
batch of ~25.

## What the labels said

262 labelled source–claim pairs, 49 `rel` and 118 `irr`, re-scored with the new
metric and joined to the existing labels by title.

At the current floor it is plainly worse — for every relevant source rescued it
admits fifteen irrelevant ones:

```
newly cleared the 0.42 floor:   rel 1 · marg 13 · irr 15
```

The reason is scale, not topicality. A short query has higher cosine similarity
with *everything* than a full sentence does, so the whole distribution shifts up
and a floor calibrated for claim-length text no longer means what it meant.
Values like 0.15 → 0.52 are not the metric discovering relevance.

Swept properly, the new metric is a genuinely **better ranker** — at high
precision it dominates:

```
floor   OLD  rel kept / irr admitted     NEW  rel kept / irr admitted
0.42         48/49      46/118                49/49      60/118
0.50         43/49      23/118                44/49      34/118
0.65         18/49       3/118                27/49       3/118
0.75          3/49       0/118                12/49       0/118
```

At 0.65 it keeps 27 relevant against the old metric's 18 for the same 3
irrelevant. At 0.75 it keeps 12 against 3 for zero irrelevant.

## Why it was still reverted

The product does not operate at 0.65. At the floor it actually uses, the change
is a wash at best. Shipping it *and* raising the floor to 0.50 would rescue
05-C4 (0.514) and cut irrelevant admissions from 46 to 34 — but it drops 4
relevant sources across every claim in the app, and the threshold would have
been fitted post hoc, on the same 262 pairs used to judge it, labelled by one
person.

Moving a global floor to make one claim pass is the shape of change this eval
exists to prevent. 05-C4 stays broken, visibly, which is the better outcome.

## What would settle it

The metric change and the floor are separable, and only the second is
contentious. Worth revisiting as a deliberate recalibration — new labels, held
out from the sweep — rather than as a side effect of chasing one sentence. If
that happens, the sweep above is the starting table and `max(claim, query)`
is worth carrying into it.
