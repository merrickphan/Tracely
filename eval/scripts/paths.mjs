// Shared locations for the offline measurement scripts in this directory.
//
// These scripts are not part of `npm run evaluate`. That harness runs the real
// pipeline against the essays and costs network calls; these re-measure ranking
// and stance decisions offline, against a report the harness already produced
// and the hand labels in eval/baseline.md. They are how a modelling claim gets
// checked without spending another provider quota.

import { existsSync, readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

/** Repo root, as a forward-slash path — Node accepts these on Windows and they
 *  survive being interpolated into a file:// URL, which backslashes do not. */
export const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

export const BASELINE = `${REPO}/eval/baseline.md`

// Gitignored on purpose: it is a cache of ~40 third-party abstracts fetched by
// DOI, not source. eval/scripts/fetch-abstracts.mjs rebuilds it in about a
// minute, so the measurements stay reproducible without vendoring other
// people's text into the repo.
export const CACHE = `${REPO}/out/eval/abstracts.json`

/**
 * The report eval/baseline.md was labelled against.
 *
 * Read from the baseline rather than guessed, because these scripts join a
 * report's claims to the baseline's labels BY POSITION, and that join is only
 * valid for the one report the labels were written from. Any other report is
 * silently mislabelled: a different run detected 14 claims instead of 13, so
 * every label after the extra one shifts by one and the measurement still
 * prints a confident percentage from labels attached to the wrong sources.
 *
 * "Newest report on disk" was the first thing tried here and is wrong twice
 * over — the newest run also has the fewest sources, because it was made while
 * OpenAlex was rate-limiting.
 *
 * Pass a path as the first argument to override, e.g. after re-labelling.
 */
export function reportPath() {
  const override = process.argv[2]
  if (override) return override

  const named = readFileSync(BASELINE, 'utf8').match(/report-[\dTZ.\-]+\.(?:json|md)/)
  if (!named) {
    throw new Error(`${BASELINE} does not name the report it labels — pass a report path explicitly`)
  }

  const file = named[0].replace(/\.md$/, '.json')
  const path = `${REPO}/eval/reports/${file}`
  if (!existsSync(path)) {
    const dir = `${REPO}/eval/reports`
    const have = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []
    throw new Error(
      `${BASELINE} labels ${file}, which is not in eval/reports (gitignored).\n` +
        `  on disk: ${have.join(', ') || '(none)'}\n` +
        `  re-run \`npm run evaluate\` and re-label, or pass a report path explicitly.`
    )
  }

  console.log(`report: ${file} (labelled by eval/baseline.md)\n`)
  return path
}

/**
 * Fails loudly when a report's claims don't line up with the baseline's
 * sections, since the join between them is positional and has no other way to
 * notice it has gone wrong.
 */
export function assertAligned(claims, sections) {
  if (claims.length !== sections.length) {
    throw new Error(
      `report has ${claims.length} claims but eval/baseline.md has ${sections.length} labelled sections — ` +
        `the positional join between them is invalid, so every number below would be computed ` +
        `from labels attached to the wrong sources.`
    )
  }
}
