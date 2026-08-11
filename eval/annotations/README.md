# Hand annotations

One JSON file per essay in `eval/essays/`, named after it. These are the ground
truth every measurement in `eval/scripts/` is computed against.

```bash
npm run eval:import-baseline   # bootstrap from eval/baseline.md (once)
npm run eval:validate          # after every edit
npm run eval:fit               # fit scoring weights against the labels
```

## Why not just keep extending `eval/baseline.md`

Two reasons, both recorded as failures rather than preferences.

**It joins to a report by position.** `eval/scripts/paths.mjs` documents the
cost: one extra detected claim shifts every subsequent label onto the wrong
sources, and the measurement still prints a confident percentage. Annotations
here join by **verbatim claim text**, and `eval:validate` refuses to run if a
sentence isn't in the essay it claims to be in.

**Its labels are prose.** `MMWR School Start Times US 2011–12` is a human
shorthand for a paper actually titled *School Start Times for Middle School and
High School Students — United States, 2011–12 School Year*. That reads well and
cannot be joined to anything mechanically.

`baseline.md` stays as the written record of the 2026-08-08 run. These files are
what scripts read.

## Shape

```json
{
  "essay": "01-school-start-times.txt",
  "labelledBy": "merrick",
  "report": "report-2026-08-08T02-37-26-088Z.json",

  "draft": {
    "grade": 74,
    "roles": ["thesis", "claim", "evidence", "counterargument", "conclusion"]
  },

  "claims": [
    {
      "text": "the sentence, copied verbatim from the essay",
      "paragraph": 2,
      "verdict": "miscited",
      "citationWorthy": "yes",

      "citedSource": {
        "doi": "10.1234/example",
        "says": "what the source actually claims, in your words"
      },

      "support": { "rel": 1, "total": 8 },
      "sources": [
        { "doi": "10.15585/mmwr.mm6430a1", "title": "…", "label": "rel" }
      ],

      "note": "free text, ignored by every script"
    }
  ]
}
```

Everything except `essay`, `claims` and each claim's `text` is optional. `null`
means *not judged yet* and is valid — that's what the importer writes rather
than guessing.

### `verdict` — about the claim

| | |
|---|---|
| `supported` | the literature backs this as written |
| `unsupported` | nothing found either way; may still be true |
| `contradicted` | the literature argues against it |
| `miscited` | a real source is cited, and it does not say this |
| `unverifiable` | no source could settle it — a prediction, a value judgement |

`miscited` **requires `citedSource.says`**, and validation enforces it. The
entire signal is the gap between what the sentence asserts and what the source
actually claims; half that pair is not a label, it's an opinion.

### `label` — about one retrieved source

Same three verdicts `baseline.md` uses, kept identical so numbers stay
comparable across the format change.

| | |
|---|---|
| `rel` | actually evidence for this specific claim |
| `marg` | right topic, doesn't evidence the claim as phrased |
| `irr` | not about this claim at all |

### `draft.roles`

One role per paragraph, in order, from the same set as `ParagraphRole` in
`src/shared/types.ts`. Must have exactly as many entries as the essay has
paragraphs — where a paragraph is **any newline run**, matching
`splitParagraphs`. Use `"unknown"` when you genuinely can't tell; that's a real
answer here for the same reason it is in the app.

## What to collect, if you're deciding where to spend annotation time

Ranked by what it unblocks:

1. **`sources[].label`** — the relevance floor and the scoring weights are
   fitted against these. ~200 labelled sources before the floor stops moving
   with individual judgements. The 2026-08-08 run has 102 already labelled in
   prose that couldn't be imported; re-labelling those is the cheapest 102.
2. **`draft.roles`** — trains a paragraph-role classifier as a linear probe on
   the MiniLM embeddings already shipping. ~300–500 paragraphs. This is the one
   that *removes* an API call rather than holding cost flat: it replaces the
   `classify-structure` relay endpoint.
3. **`verdict` + `citedSource.says`** — miscitation detection. Hardest, most
   valuable, needs the most examples, and needs source text rather than just a
   DOI.

Two things worth knowing before you start:

- **Flawed essays carry more signal than clean ones.** A perfect essay
  contributes almost no negatives. Aim for roughly 3:1 flawed to clean.
- **One annotator means one idiolect.** A model fitted only to your judgements
  learns *you*. That's fine for a tool you're building for yourself, and worth
  knowing before calling it general.
