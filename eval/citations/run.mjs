// Does the citation detector find the citations a writer actually typed?
//
// This is the measurement `eval/` did not have. The nine essays in
// eval/essays contain two citation-shaped strings between them, so retrieval
// has been measured across two labelled runs while the detector feeding
// `hasInlineCitation` into problemKind.ts has never been measured on a draft at
// all. Its only coverage is src/shared/inlineCitation.test.ts — 16 cases, every
// one written after a real document broke it in front of someone. That proves
// the last five bugs stay fixed and says nothing about the sixth.
//
// Free to run: no relay, no provider, no model. Pure string matching against
// hand labels, so it belongs in CI in a way `npm run evaluate` never can.
//
//   node eval/citations/run.mjs            # summary
//   node eval/citations/run.mjs --verbose  # every sentence and its verdict
//
// Two numbers, and the second is the one to watch:
//
//   RECALL     of the citations a writer typed, how many are seen.
//              A miss tells a correctly-cited sentence it is missing a
//              citation — loud, insulting, and at least reported.
//   PRECISION  of the sentences called cited, how many really are.
//              A false positive silently DROPS a card. Nobody reports it,
//              because nothing appears on screen to report.
//
// Both are measured twice, because production asks the question two ways:
//
//   sentence  hasInlineCitation(sentence) — Screen Watch's own claim list,
//             and any stored claim with no document snapshot behind it.
//   span      hasInlineCitationNear(fullText, start, end) with the span cut
//             SHORT of the citation, which is what the relay actually returns:
//             it stops at the end of the assertion, so "(Tyche Hendricks,
//             2024)" is never inside the string being tested. sentenceAround
//             has to widen back out to the sentence to rescue it. That widening
//             is the single highest-traffic piece of this module and nothing
//             else measures it.

import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

// Node 24 strips types natively, and both of these are leaf modules with no
// value imports — the same property that lets `npm test` load them. Importing
// the REAL modules rather than reimplementing them is the whole point: a copy
// of the patterns here would drift and then measure itself.
const { hasInlineCitation, hasInlineCitationNear, inlineCitationKind } = await import(
  pathToFileURL(`${REPO}/src/shared/inlineCitation.ts`).href
)
const { splitSentences } = await import(pathToFileURL(`${REPO}/src/main/services/ai/sentenceSplit.ts`).href)

const verbose = process.argv.includes('--verbose')

/**
 * Where a detected claim's span usually ends: at the end of the assertion,
 * before the citation that follows it.
 *
 * Approximated by cutting the sentence at the first character of its citation.
 * That is the harshest honest version of what the relay returns — the whole
 * point of the span measurement is that the citation is OUTSIDE the span.
 */
function spanBeforeCitation(sentence, citationText) {
  const at = sentence.indexOf(citationText)
  if (at <= 0) return null
  return sentence.slice(0, at).trimEnd()
}

const cases = readdirSync(`${HERE}/labels`)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(`${HERE}/labels/${f}`, 'utf8')))

// Sentence counts and citation counts are tracked separately because they are
// not the same number: a footnote mark can land in the same sentence as the
// next citation (see the splitSentences finding in FINDINGS.md), so one
// sentence can carry two. Recall is over SENTENCES, because that is the unit
// problemKind.ts asks about; shape coverage is over CITATIONS, because that is
// the unit the patterns are written against.
const totals = {
  citedSentences: 0,
  sentenceHits: 0,
  spanHits: 0,
  uncited: 0,
  falsePositives: 0,
  knownFalsePositives: 0,
  knownGapMisses: 0
}
const misses = []
const spanMisses = []
const falsePositives = []
const shapes = new Map()

for (const labels of cases) {
  const text = readFileSync(`${HERE}/essays/${labels.essay}`, 'utf8')
  const sentences = splitSentences(text)

  // Validate before measuring, the same rule eval/annotations/README.md sets:
  // a label that is not in the essay verbatim is not a label, it is a typo that
  // would print a confident percentage computed from nothing.
  const declared = [...labels.citations, ...(labels.expectedFalsePositives ?? [])]
  for (const c of declared) {
    if (!text.includes(c.text)) {
      throw new Error(`${labels.essay}: labelled string not present verbatim: ${JSON.stringify(c.text)}`)
    }
  }

  // Which sentence carries each labelled citation. Joined by containment
  // rather than by index, so a change to splitSentences cannot silently
  // re-point every label at the wrong sentence.
  // A LIST per sentence, not one label. Keyed by index with a bare `set` this
  // silently dropped a citation whenever two shared a sentence, and reported a
  // total one lower than the labels on disk — the exact class of quiet
  // miscount eval/annotations/README.md exists to prevent.
  const citedIdx = new Map()
  for (const c of labels.citations) {
    const i = sentences.findIndex((s) => s.text.includes(c.text))
    if (i === -1) {
      throw new Error(
        `${labels.essay}: ${JSON.stringify(c.text)} is in the essay but spans a sentence boundary ` +
          `as splitSentences sees it — the join below would be meaningless.`
      )
    }
    citedIdx.set(i, [...(citedIdx.get(i) ?? []), c])
  }

  // Shape coverage, measured on the citation string ALONE.
  //
  // Separate from the sentence pass on purpose: a sentence carrying two
  // citations is detected if EITHER matches, so crediting both shapes for one
  // match would report a pattern as working on the strength of a different
  // pattern sitting beside it.
  for (const c of labels.citations) {
    const shape = shapes.get(c.shape) ?? { found: 0, total: 0 }
    shape.total++
    if (hasInlineCitation(c.text)) shape.found++
    shapes.set(c.shape, shape)
  }
  const knownFp = new Set(
    (labels.expectedFalsePositives ?? [])
      .map((c) => sentences.findIndex((s) => s.text.includes(c.text)))
      .filter((i) => i !== -1)
  )

  let hits = 0
  let spanHits = 0
  let fps = 0

  sentences.forEach((sentence, i) => {
    const carried = citedIdx.get(i)
    const detected = hasInlineCitation(sentence.text)

    if (carried) {
      totals.citedSentences++

      if (detected) {
        hits++
        totals.sentenceHits++
      } else {
        // A sentence nothing matched: every citation in it was missed.
        for (const label of carried) {
          if (label.expected === 'known-gap') totals.knownGapMisses++
          misses.push({ essay: labels.essay, ...label, sentence: sentence.text.trim() })
        }
      }

      // The span path: hand it the assertion alone and see whether widening
      // back to the sentence finds the citation the span was cut short of.
      // Cut before the EARLIEST citation in the sentence, so a second one
      // later in the string cannot rescue the first.
      const first = carried.reduce((earliest, c) =>
        sentence.text.indexOf(c.text) < sentence.text.indexOf(earliest.text) ? c : earliest
      )
      const truncated = spanBeforeCitation(sentence.text, first.text)
      if (truncated === null) {
        // The citation opens the sentence, so there is nothing to cut — the
        // span case is the sentence case. Counted as a hit iff the sentence was.
        if (detected) spanHits++
        else spanMisses.push({ essay: labels.essay, ...first, span: '(citation opens the sentence)' })
      } else {
        const start = sentence.start
        const end = sentence.start + truncated.length
        if (hasInlineCitationNear(text, start, end)) spanHits++
        else spanMisses.push({ essay: labels.essay, ...first, span: truncated.trim() })
      }
    } else {
      totals.uncited++
      if (detected) {
        fps++
        if (knownFp.has(i)) totals.knownFalsePositives++
        else
          falsePositives.push({
            essay: labels.essay,
            kind: inlineCitationKind(sentence.text),
            sentence: sentence.text.trim()
          })
      }
    }

    if (verbose) {
      const mark = carried ? (detected ? 'HIT ' : 'MISS') : detected ? 'FP  ' : '    '
      console.log(`  ${mark} ${sentence.text.trim().slice(0, 96)}`)
    }
  })

  totals.spanHits += spanHits
  totals.falsePositives += fps

  const n = citedIdx.size
  console.log(
    `${labels.essay.padEnd(30)} ${String(hits).padStart(2)}/${n} sentence · ` +
      `${String(spanHits).padStart(2)}/${n} span · ${fps} false positive${fps === 1 ? '' : 's'}` +
      ` (${labels.style})`
  )
}

const pct = (a, b) => (b === 0 ? '—' : `${Math.round((100 * a) / b)}%`)
const flagged = totals.sentenceHits + totals.falsePositives

console.log(`
RECALL     sentence  ${totals.sentenceHits}/${totals.citedSentences}  ${pct(totals.sentenceHits, totals.citedSentences)}
           span      ${totals.spanHits}/${totals.citedSentences}  ${pct(totals.spanHits, totals.citedSentences)}
PRECISION            ${totals.sentenceHits}/${flagged}  ${pct(totals.sentenceHits, flagged)}   (${totals.uncited} uncited sentences)`)

if (totals.knownGapMisses || totals.knownFalsePositives) {
  console.log(
    `\nof which documented in inlineCitation.ts: ${totals.knownGapMisses} miss(es), ` +
      `${totals.knownFalsePositives} false positive(s)`
  )
}

console.log('\nby shape:')
for (const [shape, { found, total }] of [...shapes].sort()) {
  console.log(`  ${shape.padEnd(28)} ${found}/${total}  ${pct(found, total)}`)
}

// Undocumented failures listed in full. A percentage tells you whether to care;
// only the sentences tell you what to change.
const newMisses = misses.filter((m) => m.expected !== 'known-gap')
if (newMisses.length) {
  console.log('\nMISSED (writer cited it, Tracely will say "missing citation"):')
  for (const m of newMisses) console.log(`  ${m.essay}  ${m.text}\n    ${m.sentence}`)
}
if (falsePositives.length) {
  console.log('\nFALSE POSITIVES (no citation here, card silently dropped):')
  for (const f of falsePositives) console.log(`  ${f.essay}  matched '${f.kind}'\n    ${f.sentence}`)
}

// Reported apart from the sentence misses because the cause is different, and
// so is the fix. A sentence miss is a pattern that cannot see a shape; a span
// miss is a pattern that CAN see it, handed a window that excludes it. The
// second is a sentenceAround problem and no new regex will touch it.
const newSpanMisses = spanMisses.filter((m) => m.expected !== 'known-gap')
if (newSpanMisses.length) {
  console.log('\nSPAN MISSES (detector sees the sentence, sentenceAround does not reach the citation):')
  for (const m of newSpanMisses) console.log(`  ${m.essay}  ${m.text}\n    span: ${m.span}`)
}

// Non-zero exit on an undocumented failure, so this can gate a change to the
// patterns rather than being a number someone remembers to read.
//
// Span misses count. They were left out of this line at first, which made the
// run pass green while 6 of the 8 span failures sat unfixed in the output above
// — a gate that reports the most important finding and then exits 0 is worse
// than no gate, because it certifies the thing it just found.
//
// This currently exits 1, and that is the correct state: see FINDINGS.md 1-3.
// It goes green when they are fixed, not by being weakened until it does.
const failures = newMisses.length + falsePositives.length + newSpanMisses.length
process.exit(failures > 0 ? 1 : 0)
