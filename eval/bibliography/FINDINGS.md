# Reading the reference list

Measured 2026-08-16. Two harnesses, both free:

- `node eval/bibliography/run.mjs` — the parse, offline, 46 labelled references
  rendered into four citation styles.
- `node eval/bibliography/lookup.mjs` — the query, live against Crossref and
  Open Library, 32 hand-written reference-list entries, cached.

## Why

`[3]` and `(Shoup 45)` are pointers, not references. The authors, the year and
the title live in a list at the end of the document, and `parseReferences` reads
sentences — so an IEEE or MLA draft got **no fabrication check at all**. Not a
weaker one; none. Which drafts were covered was decided by the writer's citation
style rather than by anything about the citation, and a hallucinated source is
not less hallucinated for being numbered.

## What the numbers are

**Parse** — 46 labelled references × 4 styles = 184 cases:

| style | resolved | authors exact | invented | year |
|---|---|---|---|---|
| ieee-quoted | 46/46 | 46/46 | 0 | 46/46 |
| ieee-unquoted | 46/46 | 46/46 | 0 | 46/46 |
| mla | 44/46 | 44/46 | 0 | 44/46 |
| apa-numbered | 46/46 | 46/46 | 0 | 46/46 |

The two unresolved cases are both `Acemoglu & Robinson`, which appears twice in
the labelled set with different years. MLA's `(Acemoglu 45)` names one surname
and matches both entries, so `resolveMarkers` declines rather than picking one —
attaching the lookup to a work the sentence did not cite, and then reporting the
wrong one absent, is the failure that refusal exists to prevent.

**Lookup** — 32 entries, live:

```
REAL         21/22 corroborated
FABRICATED    0/10 corroborated
HARM             0 real entry reported absent
CAUGHT       10/10 invented entry reported absent
```

## Three failures the measurement found

Each of these was in the code, passing its unit tests, before it was run.

**1. A title word walked in as an author, 46 times out of 46.**

The parse admits a bare `Given Surname` chunk as a later author — that is how MLA
writes everyone after the first. The first version admitted one as soon as *any*
anchored author had been seen, reasoning that the anchor proved this was an
author list. It does, and that was the wrong question. In

```
A. Kahneman and B. Tversky, Neural Networks and Statistical Learning. Cambridge: Academic Press, 1979.
```

the real pair anchors the list and `Statistical Learning` walks in behind them as
a third author. `corroborate` requires every listed surname on one work, so an
invented one makes corroboration impossible — and on an entry carrying a year,
impossible corroboration is reported as absence, which is the accusation.

Fixed by admitting a bare chunk only in the style that uses the form: an entry
that has spelled a given name out (`Shoup, Donald`) is MLA. IEEE and APA use
initials throughout, so a bare chunk in one of those is title text, every time.

**2. A guessed title narrowed the query that would have found the book.**

An unquoted IEEE entry hides its title *inside* the author segment —
`R. Sedgewick and K. Wayne, Algorithms. Upper Saddle River, NJ: Addison-Wesley,
2011` — so reading a title from the text past the segment returns the publisher's
address. That string went into Open Library as a `title` filter, the book index
returned nothing for a book it holds, and two real textbooks came back reported
absent.

Two fixes, because there were two mistakes. The title is now read only from a
position the entry itself marks (inside quotes, after a parenthesised year, or
after an MLA author block), and the Open Library title filter is applied only
when the title is actually the discriminator — two surnames and a year find the
book on their own, and a subtitle a bibliography writes out but the index does
not hold can only take it away. Open Library corroborations went 3 → 6.

**3. Conference proceedings are in neither index.**

`A. Vaswani and N. Shazeer, "Attention is all you need," Advances in Neural
Information Processing Systems, 2017` — one of the most cited papers of the
decade — is in neither Crossref nor Open Library, and was reported absent.

This is not new and not caused by this work; an inline `(Vaswani & Shazeer,
2017)` has always had it. What is new is that a reference list *states the
venue*, so for the first time the gap is visible in the text the writer typed.
Absence is no longer reported for an entry naming proceedings, a preprint, a
working paper or a thesis. The gap is narrowed where the evidence exists to
narrow it, not closed — the inline path still cannot see a venue at all.

## What is deliberately not covered

- **A marker with no list behind it.** Unchecked, exactly as before. A pointer
  with nothing to point at names no author and no year.
- **A single-author entry.** Corroborate-only, the same rule
  `MIN_CHECKABLE_SURNAMES` applies inline: a query for one surname and a year
  returns a work by *someone* of that name essentially always.
- **An anonymous or corporate entry.** Dropped at parse. Same case as an
  institutional inline citation.
- **A reference list this cannot find.** Only a `References`/`Works Cited`
  heading or a descending numbered run counts. Prose is never read as a list.

## The generated corpus, and why it is generated

The 46 labelled references carry known surnames and years, so rendering each into
four styles gives a set where the right answer is known exactly rather than
judged. The titles are written to be **adversarial** — every one contains `and`
and is a run of capitalised words — because `Statistical Learning` sitting where
an author list should be is precisely how a parser invents an author, and a
corpus of well-behaved titles would have reported this parse as clean.
