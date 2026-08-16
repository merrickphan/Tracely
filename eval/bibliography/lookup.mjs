// Does a whole reference string still separate real from invented?
//
// run.mjs measures the PARSE — that the authors and year come out of an entry
// intact. This measures the QUERY, which is the other half and the one that is
// genuinely new.
//
// The inline check searches Crossref twice: surnames + the sentence's own
// words, and surnames alone. That pair was measured at 0 false alarms over 36
// real references and 0 corroborations over 10 invented pairs
// (eval/fabrication/FINDINGS.md). A resolved "[3]" has no useful sentence — a
// sentence containing a bare marker says nothing about the work, which is what
// made the marker unusable in the first place — so the first query is replaced
// with the reference-list entry itself.
//
// That substitution is defensible in principle: `query.bibliographic` is
// Crossref's reference-MATCHING field and a complete reference string is what
// it was built to take. It is still a substitution on the accusation path, and
// principle is not a number.
//
//   CORROBORATED  real entries found. A miss here is a real citation reported
//                 absent, which is the accusation this check exists to avoid.
//   FALSE MATCH   invented entries found. A hit here is worse than useless:
//                 the entry names a journal and a title, and if that text is
//                 enough to drag some unrelated paper into the result set the
//                 query is buying recall by discarding the discrimination.
//
// Free: unmetered Crossref and Open Library, cached so re-runs cost nothing.
//
//   node eval/bibliography/lookup.mjs
//   node eval/bibliography/lookup.mjs --live   # ignore the cache, re-fetch

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

const { parseBibliography } = await import(pathToFileURL(`${REPO}/src/shared/bibliography.ts`).href)
const { absenceIsInformative, corroborate, crossrefReferenceQueries, isCheckable, openLibraryReferenceQuery } =
  await import(pathToFileURL(`${REPO}/src/shared/citedReference.ts`).href)

const live = process.argv.includes('--live')
const CACHE_PATH = `${HERE}/lookup-cache.json`
const cache = existsSync(CACHE_PATH) && !live ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {}

let mailto = null
try {
  mailto = JSON.parse(readFileSync(`${REPO}/.env.eval.json`, 'utf8')).politePoolMailto ?? null
} catch {
  /* not configured — the public pool answers too, just more slowly */
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function get(url, shape) {
  if (cache[url]) return cache[url]
  await sleep(1100)
  const res = await fetch(url, { headers: { 'User-Agent': 'Tracely-eval/1.0 (bibliography check)' } })
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${url.slice(0, 60)}`)
    return []
  }
  const works = shape(await res.json())
  cache[url] = works
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1))
  return works
}

const asCrossref = (data) =>
  (data.message?.items ?? []).map((item) => ({
    title: item.title?.[0] ?? '(untitled)',
    authorSurnames: (item.author ?? []).map((a) => a.family ?? '').filter(Boolean),
    year: item.issued?.['date-parts']?.[0]?.[0] ?? null
  }))

const asOpenLibrary = (data) =>
  (data.docs ?? []).map((doc) => ({
    title: doc.title ?? '(untitled)',
    authorSurnames: doc.author_name ?? [],
    year: doc.first_publish_year ?? null,
    years: doc.publish_year ?? []
  }))

const { entries } = JSON.parse(readFileSync(`${HERE}/entries.json`, 'utf8'))

const rows = []

for (const item of entries) {
  // Through parseBibliography, not hand-built: this measures the shipping path
  // end to end, entry text in and lookup result out.
  const [entry] = parseBibliography(`References\n\n${item.text}\n`)
  if (!entry) {
    rows.push({ ...item, parsed: false })
    continue
  }
  const ref = {
    raw: '[1]',
    kind: 'bibliographic',
    surnames: entry.surnames,
    year: entry.year,
    title: entry.title,
    etAl: false,
    entry: entry.raw
  }
  if (!isCheckable(ref)) {
    rows.push({ ...item, parsed: true, checkable: false, surnames: entry.surnames, year: entry.year })
    continue
  }

  let found = null
  let via = null
  let considered = 0
  for (const [i, url] of crossrefReferenceQueries(ref, { mailto }).entries()) {
    const works = await get(url, asCrossref)
    considered += works.length
    const result = corroborate(ref, works)
    if (result.found) {
      found = result.match
      via = i === 0 ? 'entry-query' : 'names-query'
      break
    }
  }
  if (!found) {
    const bookUrl = openLibraryReferenceQuery(ref)
    if (bookUrl) {
      const books = await get(bookUrl, asOpenLibrary)
      considered += books.length
      const result = corroborate(ref, books)
      if (result.found) {
        found = result.match
        via = 'openlibrary'
      }
    }
  }

  rows.push({
    ...item,
    parsed: true,
    checkable: true,
    surnames: entry.surnames,
    year: entry.year,
    corroborated: Boolean(found),
    matched: found?.title ?? null,
    via,
    considered,
    accuses: absenceIsInformative(ref)
  })
}

// ---------------------------------------------------------------------------

const real = rows.filter((r) => r.label === 'real')
const fake = rows.filter((r) => r.label === 'fabricated')

const corroborated = (list) => list.filter((r) => r.corroborated)
const accusable = (list) => list.filter((r) => r.checkable && r.accuses)

console.log(`\n${rows.length} reference-list entries through the shipping path\n`)
console.log(`REAL         ${corroborated(real).length}/${real.length} corroborated`)
console.log(`FABRICATED   ${corroborated(fake).length}/${fake.length} corroborated  (any is a false match)`)

const byVia = new Map()
for (const r of corroborated(rows)) byVia.set(r.via, (byVia.get(r.via) ?? 0) + 1)
console.log(`\nwhich query found it:`)
for (const [via, n] of byVia) console.log(`  ${String(via).padEnd(14)} ${n}`)

// The harm number: a real entry NOT corroborated, on an entry whose absence the
// critique would actually be told about.
const harm = real.filter((r) => r.checkable && r.accuses && !r.corroborated)
const quiet = real.filter((r) => !r.corroborated && !(r.checkable && r.accuses))
const caught = fake.filter((r) => r.checkable && r.accuses && !r.corroborated)

console.log(`\nHARM         ${harm.length}  real entry reported absent`)
console.log(`quiet miss   ${quiet.length}  real entry uncorroborated but never reported (corroborate-only)`)
console.log(`CAUGHT       ${caught.length}/${fake.filter((r) => r.checkable && r.accuses).length}  invented entry reported absent`)

for (const r of [...harm, ...quiet, ...corroborated(fake)]) {
  console.log(`\n  ${r.label}/${r.style} — ${r.surnames?.join(' & ')} ${r.year}${r.accuses ? '' : '  (corroborate-only)'}`)
  console.log(`    ${r.text.slice(0, 110)}`)
  if (r.corroborated) console.log(`    MATCHED via ${r.via}: "${r.matched}"`)
  else console.log(`    not found across ${r.considered} candidates`)
}

console.log(
  `\n${harm.length === 0 && corroborated(fake).length === 0 ? 'PASS' : 'FAIL'} — a real entry reported absent, or an invented one corroborated.\n`
)
