# Citation-detection eval

Does `hasInlineCitation` find the citations a writer actually typed?

```bash
npm run eval:citations             # summary
npm run eval:citations -- --verbose  # every sentence and its verdict
```

Free. No relay, no provider, no model — pure string matching against hand
labels, so unlike `npm run evaluate` this can run on every change to the
patterns, and exits non-zero on any undocumented failure.

**It currently exits 1.** That is the correct state, not a broken script: see
FINDINGS.md 1-3. It goes green when those are fixed, not by being relaxed until
it does.

## Why this exists separately from `eval/essays`

The nine essays there contain **two citation-shaped strings between them**, and
neither is a reference. So retrieval has been measured across two labelled runs
while the detector feeding `hasInlineCitation` into `problemKind.ts` — the thing
that decides whether a writer is told "missing citation" — had never been
measured on a draft at all.

Its only coverage was `src/shared/inlineCitation.test.ts`: 16 cases, every one
written *after* a real document broke it in front of someone. A regression suite
proves the last five bugs stay fixed. It cannot find the sixth.

These live in their own directory rather than joining `eval/essays` because that
set joins to a report **by position** — `eval/scripts/paths.mjs` documents what
one extra essay does to every label after it.

## What is measured

| | question | why it matters |
|---|---|---|
| **RECALL, sentence** | of the citations a writer typed, how many are seen | a miss tells a correctly-cited sentence it is missing a citation |
| **RECALL, span** | same, with the span cut short of the citation | **this is the production path** — see below |
| **PRECISION** | of the sentences called cited, how many really are | a false positive silently *drops* a card |

Precision is the one to watch. A miss is loud, insulting and at least reported.
A false positive shows nothing at all, so nobody ever files it.

**The span measurement is the honest one.** The relay returns the assertion and
stops there, so a detected claim's span usually ends *before* the citation that
follows it — the string being tested does not contain the citation, and
`sentenceAround` has to widen back out to find it. That widening is the
highest-traffic code in the module and nothing else exercises it. The runner
reproduces the real conditions by cutting each span at the first character of
its citation.

## Shape of a case

An essay in `essays/`, its labels in `labels/`, joined by **verbatim citation
string** — the convention `eval/annotations/README.md` argues for, and for the
same reason: the runner refuses to start if a labelled string is not in the
essay, so a typo cannot become a confident percentage.

```json
{ "text": "(Shoup 45)", "shape": "author-page", "expected": "detected" }
```

`expected: "known-gap"` marks the two forms `inlineCitation.ts` documents as
undetectable by regex. **They still count as misses in the headline number** —
a writer who typed one has cited their sentence whatever the detector can see,
and a recall figure that quietly excluded them would be measuring the detector's
opinion of itself. They are listed separately below the total so a new failure
can be told from a known one.

`expectedFalsePositives` does the same for the naming-gloss cost the `titled`
pattern knowingly accepts.

## The seven cases

| | style | why |
|---|---|---|
| 01 | APA 7 | the shape the patterns were built for — the control |
| 02 | MLA 9 author-page | no year anywhere in the text; the US high-school default |
| 03 | MLA, citing institutions | the MUN position paper shape: 26 of its 34 citations were once invisible |
| 04 | Numeric / IEEE | no author, no year, no title — a bracketed integer is the whole signature |
| 05 | Chicago notes | superscripts and `ibid.`, as Word renders them |
| 06 | mixed first draft | styles mixed in one document, raw links, and both known gaps |
| 07 | **uncited control** | zero citations, full of shapes that look like one |

07 is the most important file here. `(Table 3)`, `(Chapter 11)`,
`(Proposition 13)`, `(down 4% since 2015)`, `(he was nine)`, quoted speech — all
the ways ordinary prose looks like a reference. Without it, recall could be
driven to 100% by a pattern that matches everything.

## The limitation, stated plainly

**These seven essays were written for this eval, not collected from real
students.** That is a genuinely weaker instrument than real drafts, and it has a
specific bias: essays written by someone who has read the patterns will tend to
contain the shapes the patterns handle.

Two things partly offset it — the cases deliberately include forms documented as
unhandled (and they do fail, visibly), and the control essay is written to
attack rather than confirm. But the honest statement is that this measures the
detector against *plausible* drafts, not observed ones.

**Replacing these with real drafts is the highest-value thing anyone can do to
this directory.** Drop a `.txt` in `essays/`, hand-label it, and it joins the
run automatically. Priority order: MLA high-school English, anything citing
institutions rather than papers, and anything written in Google Docs, where the
UIA read is worst.
