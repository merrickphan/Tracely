# Citation detection — first measurement, 2026-08-16

First time `hasInlineCitation` has been measured on drafts rather than on the
16 regression cases in `src/shared/inlineCitation.test.ts`. Run on commit
`9e6f1da`, 7 essays, 37 hand-labelled citations across 36 sentences, 66 uncited
sentences.

```
RECALL     sentence  34/36  94%
           span      28/36  78%
PRECISION            34/35  97%   (66 uncited sentences)
```

**The detector itself is in better shape than expected, and the code around it
is not.** Every pattern scores 100% on its own shape. All eight span failures
and both sentence misses come from something other than the regexes.

## 1. A footnote superscript stops the sentence splitter

`splitSentences` does not break after `posted.²` — the terminator is followed by
a superscript rather than by whitespace, so the boundary is missed and two
sentences are returned as one. On `05-chicago-notes.txt` this turns 13 sentences
into 10; every footnoted sentence is glued to the one after it.

```
  actual  "Luther's Ninety-Five Theses were reprinted … within weeks of being
           posted.² Contemporary accounts describe presses in Nuremberg …"
  control (same text, superscripts stripped) — splits correctly into two
```

**This is not a citation bug, and citations are the least of it.**
`claimDetection.ts` hands the model a numbered list of these sentences and asks
which ones state a claim. A merged pair shares one number, so the model cannot
select one without the other, and the reconstructed span — which becomes the
underline drawn over someone's document — covers both sentences. Anything with
Word footnotes is affected, which is most history and humanities writing.

Fix is in `sentenceSplit.ts`: allow trailing superscript marks (and closing
quotes/brackets) between the terminator and the boundary.

## 2. `sentenceAround` stops at the full stop, and the footnote is past it

Every Chicago case fails the span measurement — 1 of 5, against 5 of 5 at
sentence level. The pattern sees the mark perfectly; it is never shown it.

`sentenceAround` widens forward until the first terminator at bracket depth
zero, and a footnote mark sits *after* that terminator. So the window ends at
`travel.` and the `¹` is one character outside it, every time.

```
  citation  dissent could travel.¹
  window    The printing press did not create religious dissent, but it changed how fast
```

Fix: when the character after a terminator is a superscript mark, include it.
Two lines, same file as finding 1.

## 3. `sentenceAround` treats the dots inside a URL as sentence ends

```
  citation  doi: 10.1257/aer.20191325
  window    …whether the work is individual or collaborative, see

  citation  www.bls.gov/news.release/flex2.nr0.htm
  window    …while publishing no internal data at all, according to
```

The forward scan stops at the `.` in `10.1257` and in `www.`, so the window
holds a fragment that cannot satisfy a URL pattern needing a second dot. Both
`doi` and `url` are 100% at sentence level and 0% via a span.

This matters more than the count suggests: a pasted link is how students cite
when they are not using a style guide at all, and Screen Watch's UIA read
delivers rendered hyperlinks as bare `www.` text — the case `inlineCitation.ts`
added the scheme-less pattern for in the first place.

Fix: no terminator break when the following character is not whitespace. That
is the standard rule and it costs nothing here.

## 4. The two known gaps behave exactly as documented

`(42)` after a narrative author mention, and whole-work `(Cornell)`, both missed
— as `inlineCitation.ts:99-101` says they will be. No surprise, and both need
the surrounding sentences rather than a new pattern. Recorded so the number
stays honest rather than excluded.

## 5. One false positive, and it is the documented one

`("A Pool for Every Neighbourhood")` — a naming gloss read as a titled citation.
Precisely the cost `inlineCitation.ts:74` accepts when it takes any quoted
phrase of six or more characters in brackets. **No undocumented false positive
in 66 uncited sentences**, including every trap in the control essay:
`(Table 3)`, `(Chapter 11)`, `(Proposition 13)`, `(down 4% since 2015)`,
`(he was nine)`, `(up from 2019)`.

The `NOT_AN_AUTHOR` stoplist and the capital-anchor rule are doing their job.

## Fixed, same day

Findings 1-3 are fixed; 4 and 5 are the documented gaps and stay.

```
                 before          after
RECALL sentence  34/36  94%      35/37  95%
       span      28/36  78%      35/37  95%
PRECISION        34/35  97%      35/36  97%
```

Span recall now equals sentence recall, which is the result worth checking: the
window no longer loses anything the patterns can see. Chicago went 1/5 to 6/6.
The remaining two misses are finding 4 and the remaining false positive is
finding 5 — every failure left is one the module documents.

The cited-sentence total moved 36 → 37 and uncited 66 → 68 because finding 1's
fix splits the Chicago essay correctly, so there are simply more sentences than
there were. That is the fix showing up in the denominator, not a relabelling.

- `sentenceSplit.ts` — superscripts added to the boundary's closing group,
  beside the quotes that were there for the same reason.
- `inlineCitation.ts` — one `sentenceEndAt` helper, applied in both scan
  directions: absorb trailing marks, and treat a terminator with no whitespace
  after it as not a terminator. Findings 2 and 3 were the same rule missing
  twice.

Three regression tests, in the two unit suites rather than only here: 357 pass.

**One thing deliberately not changed.** `structure/roles.ts` duplicates a
simplified splitter (`/[.!?]+["'’”)\]]*\s/`) and has the same superscript
blindness. It is left alone: that module documents why it must stay a leaf with
no imports, and the failure is benign there — a footnoted first sentence makes
`afterFirstSentence` empty, so a role degrades to `unknown`, which the design
already treats as an honest answer rather than a wrong one. Worth knowing, not
worth editing a file whose comment says not to tidy it.

## What this changes about the diagnosis

The complaint that started this was "it can't even detect what a citation is."
On this evidence the patterns are not the problem — **the two functions that
decide what text the patterns get to see are**, and all three bugs live in the
same 30 lines.

That is a much cheaper problem than a detection problem, and finding 1 reaches
well past citations into claim detection itself.

Still unmeasured, and not answerable from this directory: whether real student
drafts look like these seven. See the limitation section of the README.
