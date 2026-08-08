// Does OpenAlex DOI enrichment actually fix abstract coverage?
//
// The claim being tested: Crossref finds the most relevant papers but carries
// abstracts for few of them, and OpenAlex — which is expensive to SEARCH but
// free to look up BY DOI — can fill the gap for nothing. If true, discovery
// moves to the free unmetered providers and OpenAlex becomes a metadata
// service. If false, the whole architecture argument collapses.
//
// Baseline to beat: fetch-abstracts.mjs resolved 39 of 96 DOIs (41%) from
// Crossref, falling back to Semantic Scholar.
//
// Costs nothing to run. Singleton /works/doi: lookups are 0 credits and answer
// even when the daily budget is spent — which is also what makes them the
// fallback inside enrichByDoi().

import { readFileSync } from 'fs'
import { CACHE, reportPath } from './paths.mjs'

const REPORT = reportPath()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function reconstructAbstract(index) {
  if (!index) return null
  const positions = []
  for (const [word, occurrences] of Object.entries(index)) {
    for (const pos of occurrences) positions[pos] = word
  }
  const text = positions.filter(Boolean).join(' ')
  return text || null
}

const claims = Object.values(JSON.parse(readFileSync(REPORT, 'utf8'))).flatMap((e) => e.claims)
const dois = [...new Set(claims.flatMap((c) => c.sources.map((s) => s.doi).filter(Boolean)))]

// What the Crossref-first approach managed, for comparison.
const crossrefCache = JSON.parse(readFileSync(CACHE, 'utf8'))
const crossrefHave = dois.filter((d) => crossrefCache[d]).length

console.log(`${dois.length} DOIs from the labelled report`)
console.log(`crossref + semantic scholar:  ${crossrefHave}/${dois.length} abstracts (${Math.round((100 * crossrefHave) / dois.length)}%)\n`)
console.log('looking each up on OpenAlex by DOI (0 credits each)…')

let abstracts = 0
let openAccess = 0
let retracted = 0
let missing = 0
let newlyCovered = 0
let creditsSpent = 0

for (const [i, doi] of dois.entries()) {
  try {
    await sleep(120)
    const res = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`)
    creditsSpent += Number(res.headers.get('x-ratelimit-credits-required') ?? 0)
    if (!res.ok) {
      missing++
      continue
    }
    const work = await res.json()
    const abstract = reconstructAbstract(work.abstract_inverted_index)
    if (abstract) {
      abstracts++
      if (!crossrefCache[doi]) newlyCovered++
    }
    if (work.open_access?.oa_status && work.open_access.oa_status !== 'closed') openAccess++
    if (work.is_retracted === true) {
      retracted++
      console.log(`  RETRACTED: ${String(work.display_name).slice(0, 78)}`)
    }
  } catch {
    missing++
  }
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${dois.length}`)
}

const pct = (n) => `${Math.round((100 * n) / dois.length)}%`

console.log(`\nopenalex by DOI:              ${abstracts}/${dois.length} abstracts (${pct(abstracts)})`)
console.log(`  of which NEW vs crossref:  ${newlyCovered}`)
console.log(`  open access (readable):    ${openAccess}/${dois.length} (${pct(openAccess)})`)
console.log(`  not in openalex:           ${missing}`)
console.log(`  RETRACTED papers caught:   ${retracted}`)
console.log(`\ncredits spent: ${creditsSpent} (${dois.length} lookups)`)
