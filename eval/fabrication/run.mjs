// Can a targeted lookup tell an invented citation from a real one?
//
// The `fabricated` verdict has never fired. eval/critique/FINDINGS.md, finding
// 1: the critique was shown "Ramirez and Doyle (2024)" — a study that does not
// exist, carrying every marker the relay's prompt names — and answered
// `unsupported`, because Pass 2(c) asks it to be confident a work does NOT
// exist and no model can be confident of that. The top severity tier in
// problemKind.ts is unreachable by construction.
//
// This measures the replacement: stop asking the model, and go and look. A
// query for THIS AUTHOR in THIS YEAR — not for the claim's topic, which is what
// the evidence search already does and why the fabrication went unnoticed
// (eight real, genuinely relevant papers about AI feedback came back, none of
// them the named work; nothing in that result set was ever a search for it).
//
// Two numbers, and the second is the one that decides whether this can ship:
//
//   DETECTION   the one reference known to be invented must come back
//               not-found. If it does not, the approach is dead.
//   FALSE ALARM real references called not-found. Each one is a writer told
//               they invented a source they actually cited, which is the most
//               damaging thing this product could say to someone. The bar is
//               not "low" — it is that every single one is explainable.
//
// Crossref only, and free: one unmetered request per reference, cached to
// crossref-cache.json so re-runs cost nothing and the numbers are reproducible.
//
//   node eval/fabrication/run.mjs           # summary + every not-found
//   node eval/fabrication/run.mjs --verbose # every reference and its verdict
//   node eval/fabrication/run.mjs --live    # ignore the cache, re-fetch

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

// The real module, imported rather than reimplemented — Node strips the types,
// and citedReference.ts is a leaf for exactly this reason. A copy of the
// patterns here would drift and then measure itself.
const { corroborate, crossrefReferenceQueries, isCheckable, parseReferences } = await import(
  pathToFileURL(`${REPO}/src/shared/citedReference.ts`).href
)
// Per SENTENCE, not per document: the query is anchored on the sentence's own
// words, which is what lifts the cited work above the forty other Wheatons.
const { splitSentences } = await import(
  pathToFileURL(`${REPO}/src/main/services/ai/sentenceSplit.ts`).href
)

const verbose = process.argv.includes('--verbose')
const live = process.argv.includes('--live')

const CACHE_PATH = `${HERE}/crossref-cache.json`
const cache = existsSync(CACHE_PATH) && !live ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {}

// Crossref asks for a contact address on its polite pool and is markedly faster
// with one. Read from the same place the app reads it, if it is set.
let mailto = null
try {
  const settings = JSON.parse(readFileSync(`${REPO}/.env.eval.json`, 'utf8'))
  mailto = settings.politePoolMailto ?? null
} catch {
  /* not configured — Crossref still answers, just on the public pool */
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchWorks(url, label) {
  if (cache[url]) return cache[url]
  await sleep(1100) // one request per second, well inside Crossref's guidance
  const res = await fetch(url, { headers: { 'User-Agent': 'Tracely-eval/1.0 (fabrication check)' } })
  if (!res.ok) {
    console.warn(`  ! crossref ${res.status} for ${label}`)
    return null
  }
  const data = await res.json()
  const works = (data.message?.items ?? []).map((item) => ({
    title: item.title?.[0] ?? '(untitled)',
    authorSurnames: (item.author ?? []).map((a) => a.family ?? '').filter(Boolean),
    year: item.issued?.['date-parts']?.[0]?.[0] ?? null
  }))
  cache[url] = works
  return works
}

/**
 * Both queries, stopping at the first corroboration.
 *
 * Not "the first query that returns results" — every query returns twenty
 * results. The stop condition is a work carrying both cited names, which is the
 * only thing that settles the question.
 */
async function check(ref, context) {
  const urls = crossrefReferenceQueries(ref, { context, mailto })
  if (urls.length === 0) return null
  let last = { found: false, match: null, candidatesConsidered: 0 }
  for (const url of urls) {
    const works = await fetchWorks(url, ref.raw)
    if (works === null) continue
    last = corroborate(ref, works)
    if (last.found) return last
  }
  return last
}

// -- the corpus ---------------------------------------------------------------
//
// Both essay sets. eval/essays is what the pipeline evals run on; the seven in
// eval/citations/essays exist to exercise citation SHAPES and so carry the
// widest variety of reference styles in the repo, which is what this needs.
const dirs = [`${REPO}/eval/essays`, `${REPO}/eval/citations/essays`]
const essays = dirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => ({ file: `${dir.split('/').pop()}/${f}`, text: readFileSync(`${dir}/${f}`, 'utf8') }))
)

/**
 * The one reference in the corpus KNOWN to be invented.
 *
 * Planted deliberately and documented as such in eval/critique/expected.json
 * before any of this existed — "THE HEADLINE TEST. This study does not exist."
 * Named here rather than discovered, so this file cannot mark its own homework
 * by deciding after the fact which not-founds were the real ones.
 */
const KNOWN_FABRICATED = [{ surnames: ['Ramirez', 'Doyle'], year: 2024 }]

const isKnownFabricated = (ref) =>
  KNOWN_FABRICATED.some(
    (known) =>
      known.year === ref.year &&
      known.surnames.length === ref.surnames.length &&
      known.surnames.every((s, i) => s.toLowerCase() === ref.surnames[i]?.toLowerCase())
  )

// -- run ----------------------------------------------------------------------

const rows = []
const skipped = []

const seenRefs = new Set()

for (const essay of essays) {
  for (const sentence of splitSentences(essay.text)) {
    for (const ref of parseReferences(sentence.text)) {
      // One reference, one lookup, however many times an essay cites it.
      const key = `${essay.file}|${ref.surnames.join('+')}|${ref.year}`
      if (seenRefs.has(key)) continue
      seenRefs.add(key)

      if (!isCheckable(ref)) {
        skipped.push({ essay: essay.file, ref })
        continue
      }
      const result = await check(ref, sentence.text)
      if (result === null) continue
      rows.push({ essay: essay.file, ref, result, planted: isKnownFabricated(ref) })
      if (verbose) {
        console.log(
          `  ${result.found ? 'found    ' : 'NOT FOUND'} ${ref.raw.padEnd(34)} ` +
            `${String(result.candidatesConsidered).padStart(2)} candidates  ${essay.file}`
        )
      }
    }
  }
}

mkdirSync(HERE, { recursive: true })
writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1), 'utf8')

// -- report -------------------------------------------------------------------

const checked = rows.length
const notFound = rows.filter((r) => !r.result.found)
const planted = rows.filter((r) => r.planted)
const plantedCaught = planted.filter((r) => !r.result.found)

console.log(`\n  ${essays.length} essays · ${checked + skipped.length} references parsed`)
console.log(`  ${checked} checkable (author + year) · ${skipped.length} skipped\n`)

console.log('  DETECTION — references known to be invented')
if (planted.length === 0) {
  console.log('    none in the corpus — this run proves nothing about detection\n')
} else {
  for (const row of planted) {
    console.log(
      `    ${row.result.found ? 'MISSED ' : 'caught '} ${row.ref.raw}  ` +
        `(${row.result.candidatesConsidered} works by that author in that year, none carrying both names)`
    )
  }
  console.log(`    ${plantedCaught.length}/${planted.length}\n`)
}

console.log(`  FALSE ALARM — real references the lookup could not corroborate`)
const suspects = notFound.filter((r) => !r.planted)
console.log(`    ${suspects.length}/${checked - planted.length}`)
for (const row of suspects) {
  console.log(
    `    · ${row.ref.raw.padEnd(34)} ${row.essay}  ` +
      `(${row.result.candidatesConsidered} candidates considered)`
  )
}

// Skipped is not "passed". A reference the check cannot look at is one a
// fabrication could hide behind, and the shape of what gets skipped decides
// which drafts this can cover at all.
const skipReason = (ref) =>
  ref.kind !== 'author-year' ? ref.kind : ref.etAl ? 'et al. (one name)' : 'single author'
const byKind = new Map()
for (const s of skipped) byKind.set(skipReason(s.ref), (byKind.get(skipReason(s.ref)) ?? 0) + 1)
console.log(`\n  SKIPPED — no check possible`)
for (const [kind, n] of byKind) console.log(`    ${kind.padEnd(16)} ${n}`)
if (verbose) for (const s of skipped) console.log(`    · ${s.ref.raw}  ${s.essay}`)

console.log(
  `\n  Numeric ([3]) and MLA author-page ("Shoup 45") references are not parsed at\n` +
    `  all — they carry no year, so an IEEE or MLA draft gets no fabrication check.`
)

// -- the labelled set ---------------------------------------------------------
//
// The corpus above contains four checkable pairs, which cannot support a
// false-alarm rate. references.json is labelled from knowledge of the
// literature rather than from any index — a `real` label read off a Crossref
// hit would be measuring the index against itself.
const labelled = JSON.parse(readFileSync(`${HERE}/references.json`, 'utf8')).references

console.log(`\n\n  ===  labelled reference set (${labelled.length})  ===\n`)

const results = { real: [], fabricated: [] }
for (const entry of labelled) {
  const ref = {
    raw: `${entry.surnames.join(' and ')} (${entry.year})`,
    kind: 'author-year',
    surnames: entry.surnames,
    year: entry.year,
    title: null,
    etAl: false
  }
  const result = await check(ref, entry.context)
  if (result === null) continue
  results[entry.label].push({ entry, result })
  if (verbose) {
    console.log(
      `  ${result.found ? 'found    ' : 'NOT FOUND'} ${entry.label.padEnd(11)} ${ref.raw.padEnd(32)}` +
        (result.match ? ` ${result.match.title.slice(0, 46)}` : '')
    )
  }
}

writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1), 'utf8')

const caught = results.fabricated.filter((r) => !r.result.found)
const alarms = results.real.filter((r) => !r.result.found)

console.log(`  DETECTION   ${caught.length}/${results.fabricated.length} invented references not corroborated`)
for (const r of results.fabricated.filter((x) => x.result.found)) {
  console.log(`    MISSED  ${r.entry.surnames.join(' & ')} ${r.entry.year} -> ${r.result.match.title.slice(0, 60)}`)
}

// Broken out by form, because the two are not the same risk. Crossref registers
// DOIs for the scholarly record: it carries journal articles almost completely
// and trade books barely at all. A rate averaged over both hides which drafts
// the check is safe on.
const byForm = (form) => results.real.filter((r) => (r.entry.form ?? 'article') === form)
console.log(`\n  FALSE ALARM ${alarms.length}/${results.real.length} real references not corroborated`)
for (const form of ['article', 'book', 'pre-doi', 'textbook']) {
  const set = byForm(form)
  if (set.length === 0) continue
  console.log(`    ${form.padEnd(8)} ${set.filter((r) => !r.result.found).length}/${set.length}`)
}
for (const r of alarms) {
  console.log(
    `    · ${(r.entry.form ?? 'article').padEnd(8)} ${r.entry.surnames.join(' & ')} ${r.entry.year}  ` +
      `(${r.result.candidatesConsidered} candidates)  ${r.entry.note ?? ''}`
  )
}

console.log(
  `\n  A "not corroborated" is EVIDENCE, not a verdict. On the book set it is\n` +
    `  wrong often enough that nothing downstream may treat it as one on its own.\n`
)
