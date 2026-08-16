// Loading and joining, once, for rank.mjs / robustness.mjs / stance.mjs.
//
// Each of the three grew its own copy of "read the labels, find the report,
// match claims by text prefix, assert the lengths agree". Three copies of a
// join is how eval/scripts/paths.mjs's positional-join bug happened in the
// first place — one of them gets a fix and the others quietly keep reporting
// confident percentages from labels attached to the wrong sources.
//
// One labels file per (report, essay set), all in labels/. Adding a file is how
// the eval set grows; nothing else needs editing.

import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

export { HERE, REPO }

/**
 * Every labelled claim across every labels file, with its report sources
 * attached.
 *
 * Joined by claim-text prefix within a report, never by index across reports.
 * Throws rather than guessing: a label that matches no claim, or two, is a
 * broken join, and the whole point of this directory is that its numbers can be
 * trusted to describe the sources they say they do.
 */
export function loadLabelled() {
  const files = readdirSync(`${HERE}/labels`)
    .filter((f) => f.endsWith('.json'))
    .sort()
  if (files.length === 0) throw new Error(`no label files in ${HERE}/labels`)

  const rows = []
  const sets = []

  for (const file of files) {
    const labels = JSON.parse(readFileSync(`${HERE}/labels/${file}`, 'utf8'))
    const report = JSON.parse(readFileSync(`${REPO}/eval/reports/${labels.report}`, 'utf8'))
    const flat = report.flatMap((essay) => essay.claims.map((claim) => ({ essay: essay.file, claim })))

    for (const labelled of labels.claims) {
      const hits = flat.filter((r) => r.claim.text.startsWith(labelled.claim))
      if (hits.length !== 1) {
        throw new Error(
          `${file}: ${JSON.stringify(labelled.claim)} matches ${hits.length} claims in ${labels.report} — ` +
            `the join is ambiguous, so every number computed from it would be meaningless.`
        )
      }
      const { essay, claim } = hits[0]
      // Fewer verdicts than sources is allowed and is how the two label files
      // stay comparable: MAX_EVIDENCE_RESULTS moved from 8 to 16 in 2b0c0e9,
      // and precision over a 16-long list is mechanically worse than over an
      // 8-long one whatever retrieval does. Later files label the top 8 and the
      // rest of the list is simply not judged. MORE verdicts than sources is
      // always an error — that is a label pointing at nothing.
      if (labelled.verdicts.length > claim.sources.length) {
        throw new Error(
          `${file}: ${labelled.claim} has ${labelled.verdicts.length} verdicts but only ` +
            `${claim.sources.length} sources in the report.`
        )
      }
      const sources = claim.sources.slice(0, labelled.verdicts.length)
      const firstRel = labelled.verdicts.indexOf('rel')
      rows.push({
        file,
        essay,
        claim,
        labelled,
        verdicts: labelled.verdicts,
        sources,
        rel: labelled.verdicts.filter((v) => v === 'rel').length,
        marg: labelled.verdicts.filter((v) => v === 'marg').length,
        firstRelRank: firstRel === -1 ? null : firstRel + 1
      })
    }
    sets.push({ file, report: labels.report, labelledBy: labels.labelledBy, spotCheckedBy: labels.spotCheckedBy })
  }

  return { rows, sets }
}

/** Percentage, or an em dash when the denominator is zero. */
export const pct = (a, b) => (b === 0 ? '—' : `${Math.round((100 * a) / b)}%`)
