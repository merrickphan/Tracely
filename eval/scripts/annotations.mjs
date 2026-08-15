// Loading, validating and joining hand annotations.
//
// WHY THIS EXISTS AT ALL, given eval/baseline.md already holds hand labels:
//
// baseline.md joins to a report BY POSITION. paths.mjs documents what that
// costs — one extra detected claim shifts every subsequent label onto the
// wrong sources, and the measurement still prints a confident percentage. The
// labels are also prose ("MMWR School Start Times US 2011-12" for a source
// actually titled "School Start Times for Middle School and High School
// Students - United States, 2011-12 School Year"), so nothing downstream can
// join to a source without fuzzy matching that would silently mislabel.
//
// Annotations here join by VERBATIM CLAIM TEXT and by DOI. Both are checked
// against the essay and the report before any number is computed, so a stale
// annotation fails loudly instead of measuring the wrong thing. That check is
// the entire value of this file; the JSON shape is incidental.

import { existsSync, readdirSync, readFileSync } from 'fs'
import { REPO } from './paths.mjs'

export const ANNOTATIONS_DIR = `${REPO}/eval/annotations`
export const ESSAYS_DIR = `${REPO}/eval/essays`

/** A source's relationship to the claim it was retrieved for. Same three
 *  verdicts eval/baseline.md uses, kept identical so the numbers stay
 *  comparable across the change of format. */
export const SOURCE_LABELS = ['rel', 'marg', 'irr']

/** What the annotator concluded about the claim itself, independent of what
 *  retrieval happened to find. `miscited` is the one that motivated the whole
 *  exercise: a real source, correctly formatted, that does not say what the
 *  sentence claims it says. */
export const CLAIM_VERDICTS = [
  'supported',
  'unsupported',
  'contradicted',
  'miscited',
  // The mirror image of `miscited`: miscited is a real source that does not say
  // what the sentence claims, `fabricated` is a source that does not exist at
  // all. Added because 08-ai-grading cites an invented "Ramirez and Doyle
  // (2024)" and had to be filed as `unsupported` — a verdict that reads back as
  // "nothing found either way; may still be true", which is far too generous
  // for a reference nobody wrote, and which put it in the same bucket as a
  // claim the literature simply has not studied.
  //
  // 05-social-media (real source, wrong claim) and 08-ai-grading (no source at
  // all) produce identical retrieval behaviour and are not the same mistake.
  // Keeping one verdict for both meant no downstream fit could ever tell them
  // apart. See eval/RUBRIC.md, "The cases this rubric does not settle".
  'fabricated',
  'unverifiable'
]

/** Paragraph roles, mirroring ParagraphRole in src/shared/types.ts.
 *  Duplicated rather than imported because these scripts are plain .mjs and
 *  cannot load the TypeScript source. If the union there grows, grow this. */
export const PARAGRAPH_ROLES = [
  'thesis',
  'claim',
  'evidence',
  'reasoning',
  'significance',
  'counterargument',
  'conclusion',
  'transition',
  'unknown'
]

/**
 * Paragraph boundaries, matching splitParagraphs in src/shared/paragraphSplit.ts:
 * ANY newline run is a boundary, not only a blank line. Same duplication caveat
 * as PARAGRAPH_ROLES — if that rule changes, this has to follow, or annotated
 * paragraph indices stop meaning what the app means by them.
 */
export function splitParagraphs(text) {
  const spans = []
  let index = 0
  const re = /[\r\n]+/g
  let cursor = 0
  let match
  while ((match = re.exec(text)) !== null) {
    const chunk = text.slice(cursor, match.index)
    if (chunk.trim()) spans.push({ index: ++index, start: cursor, end: match.index, text: chunk })
    cursor = match.index + match[0].length
  }
  const tail = text.slice(cursor)
  if (tail.trim()) spans.push({ index: ++index, start: cursor, end: text.length, text: tail })
  return spans
}

function fail(problems, file, message) {
  problems.push(`${file}: ${message}`)
}

/**
 * Read every annotation file, validating each against the essay it labels.
 *
 * Returns { annotations, problems }. Callers decide whether to proceed on
 * problems — validate-annotations.mjs exits non-zero, fit-weights.mjs refuses
 * to fit at all, because a fit over labels that don't line up is worse than no
 * fit: it produces a number nobody can tell is wrong.
 */
export function loadAnnotations() {
  const problems = []
  const annotations = []

  if (!existsSync(ANNOTATIONS_DIR)) {
    return { annotations, problems: [`${ANNOTATIONS_DIR} does not exist`] }
  }

  const files = readdirSync(ANNOTATIONS_DIR).filter((f) => f.endsWith('.json'))
  for (const file of files) {
    let parsed
    try {
      parsed = JSON.parse(readFileSync(`${ANNOTATIONS_DIR}/${file}`, 'utf8'))
    } catch (error) {
      fail(problems, file, `not valid JSON — ${error.message}`)
      continue
    }

    if (typeof parsed.essay !== 'string') {
      fail(problems, file, 'missing "essay"')
      continue
    }

    const essayPath = `${ESSAYS_DIR}/${parsed.essay}`
    if (!existsSync(essayPath)) {
      fail(problems, file, `labels ${parsed.essay}, which is not in eval/essays`)
      continue
    }
    const essay = readFileSync(essayPath, 'utf8')
    const paragraphs = splitParagraphs(essay)

    if (!Array.isArray(parsed.claims)) {
      fail(problems, file, 'missing "claims" array')
      continue
    }

    parsed.claims.forEach((claim, i) => {
      const at = `claim ${i + 1}`

      if (typeof claim.text !== 'string' || !claim.text.trim()) {
        fail(problems, file, `${at}: missing "text"`)
        return
      }

      // The check this whole module exists for. An annotation whose sentence
      // is not in the essay is labelling something that is not there — an
      // edited essay, a paraphrase, a typo in transcription. Any of those
      // silently poisons every downstream number.
      const offset = essay.indexOf(claim.text)
      if (offset === -1) {
        fail(
          problems,
          file,
          `${at}: text does not occur verbatim in ${parsed.essay} — ` +
            `"${claim.text.slice(0, 60)}…"`
        )
        return
      }
      if (essay.indexOf(claim.text, offset + 1) !== -1) {
        fail(problems, file, `${at}: text occurs more than once, so it cannot identify one claim`)
        return
      }

      const actual = paragraphs.find((p) => offset >= p.start && offset < p.end)
      if (claim.paragraph !== undefined && actual && claim.paragraph !== actual.index) {
        fail(
          problems,
          file,
          `${at}: annotated paragraph ${claim.paragraph}, but the text starts in paragraph ${actual.index}`
        )
      }

      // null is "not judged yet", and is what import-baseline.mjs writes rather
      // than inventing a verdict. It has to stay valid or the imported files
      // fail validation the moment they are created.
      if (claim.verdict != null && !CLAIM_VERDICTS.includes(claim.verdict)) {
        fail(problems, file, `${at}: verdict "${claim.verdict}" is not one of ${CLAIM_VERDICTS.join('|')}`)
      }

      if (claim.support) {
        const { rel, total } = claim.support
        if (typeof rel === 'number' && typeof total === 'number' && rel > total) {
          fail(problems, file, `${at}: support.rel (${rel}) exceeds support.total (${total})`)
        }
      }

      // A miscitation claim with nothing recorded about the source is not
      // checkable and not trainable — the whole signal is the gap between what
      // the sentence asserts and what the source says, and half of that pair
      // would be missing.
      if (claim.verdict === 'miscited' && !claim.citedSource?.says) {
        fail(problems, file, `${at}: verdict "miscited" requires citedSource.says (what the source actually claims)`)
      }

      // The mirror-image rule, and the reason `fabricated` is safe to add.
      // Saying a student invented a source is the most serious thing this
      // project can assert about a draft, and it is unfalsifiable unless the
      // search behind it is on the record. Without `citedSource.searchedFor`
      // the annotation is an accusation; with it, a later reader can re-run the
      // search and overturn the label. `miscited` requires the source's words
      // for the same reason: whichever half of the pair carries the finding has
      // to be written down.
      if (claim.verdict === 'fabricated' && !claim.citedSource?.searchedFor) {
        fail(
          problems,
          file,
          `${at}: verdict "fabricated" requires citedSource.searchedFor (what was searched for and not found)`
        )
      }

      if (claim.sources !== undefined) {
        if (!Array.isArray(claim.sources)) {
          fail(problems, file, `${at}: "sources" must be an array`)
        } else {
          claim.sources.forEach((source, j) => {
            if (!SOURCE_LABELS.includes(source.label)) {
              fail(
                problems,
                file,
                `${at}, source ${j + 1}: label "${source.label}" is not one of ${SOURCE_LABELS.join('|')}`
              )
            }
            if (!source.doi && !source.title) {
              fail(problems, file, `${at}, source ${j + 1}: needs a doi or a title to join on`)
            }
          })
        }
      }

      // Counts and per-source labels are both allowed — counts are what the
      // baseline import can recover, per-source labels are what new annotation
      // produces. When both are present they must agree, or one of them is
      // stale and there is no way to tell which.
      // Only when sources are actually labelled. An imported file carries counts
      // with an empty `sources`, and cross-checking those would report every
      // recovered count as a contradiction of labels nobody has written yet.
      if (claim.support && Array.isArray(claim.sources) && claim.sources.length > 0) {
        const counted = { rel: 0, marg: 0, irr: 0 }
        for (const source of claim.sources) {
          if (SOURCE_LABELS.includes(source.label)) counted[source.label]++
        }
        for (const label of SOURCE_LABELS) {
          if ((claim.support[label] ?? 0) !== counted[label]) {
            fail(
              problems,
              file,
              `${at}: support.${label} says ${claim.support[label] ?? 0}, but ${counted[label]} sources are labelled ${label}`
            )
          }
        }
      }
    })

    // null means "not labelled yet", same convention as claim.verdict.
    if (parsed.draft?.roles != null) {
      if (!Array.isArray(parsed.draft.roles)) {
        fail(problems, file, 'draft.roles must be an array')
      } else {
        if (parsed.draft.roles.length !== paragraphs.length) {
          fail(
            problems,
            file,
            `draft.roles has ${parsed.draft.roles.length} entries but ${parsed.essay} has ${paragraphs.length} paragraphs`
          )
        }
        parsed.draft.roles.forEach((role, i) => {
          if (!PARAGRAPH_ROLES.includes(role)) {
            fail(problems, file, `draft.roles[${i}]: "${role}" is not a paragraph role`)
          }
        })
      }
    }

    annotations.push({ file, ...parsed })
  }

  return { annotations, problems }
}

/**
 * Join annotated claims to the claims in a report.
 *
 * By verbatim text, not position — which means a report that detected a
 * different number of claims still joins correctly for the ones it shares, and
 * reports what it could not match rather than shifting labels along.
 */
export function joinToReport(annotations, report) {
  const byEssay = new Map()
  for (const essay of report) byEssay.set(essay.file, essay)

  const joined = []
  const unmatched = []

  for (const annotation of annotations) {
    const essay = byEssay.get(annotation.essay)
    if (!essay) {
      unmatched.push(`${annotation.file}: report has no entry for ${annotation.essay}`)
      continue
    }
    for (const claim of annotation.claims) {
      const reported = essay.claims.find((c) => c.text === claim.text)
      if (!reported) {
        unmatched.push(`${annotation.file}: report did not detect "${claim.text.slice(0, 50)}…"`)
        continue
      }
      joined.push({ essay: annotation.essay, annotation: claim, reported })
    }
  }

  return { joined, unmatched }
}
