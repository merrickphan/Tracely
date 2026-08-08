// Rebuilds the labelled baseline WITH abstracts, by DOI, from Crossref.
//
// The report captured titles but not abstracts, and OpenAlex — which supplied
// 92% of the baseline's abstracts — is rate-limiting my earlier eval runs. But
// abstracts can be fetched by DOI from Crossref, which is not rate-limited, so
// everything downstream of retrieval becomes measurable today even though
// retrieval itself does not.
//
// Cached to disk: this is 100+ network calls and the answers do not change.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

import { CACHE, reportPath } from './paths.mjs'

const REPORT = reportPath()

// Crossref returns abstracts as JATS XML, not plain text.
function stripJats(xml) {
  if (!xml) return null
  const text = xml
    .replace(/<jats:title[^>]*>[\s\S]*?<\/jats:title>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 40 ? text : null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function crossrefAbstract(doi) {
  try {
    await sleep(150)
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { 'User-Agent': 'Tracely-eval/1.0 (offline evaluation)' }
    })
    if (!res.ok) return null
    const data = await res.json()
    return stripJats(data?.message?.abstract ?? null)
  } catch {
    return null
  }
}

async function semanticScholarAbstract(doi) {
  try {
    await sleep(1100)
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=abstract`
    )
    if (!res.ok) return null
    const data = await res.json()
    return typeof data?.abstract === 'string' && data.abstract.length > 40 ? data.abstract : null
  } catch {
    return null
  }
}

const claims = Object.values(JSON.parse(readFileSync(REPORT, 'utf8'))).flatMap((e) => e.claims)
const dois = [...new Set(claims.flatMap((c) => c.sources.map((s) => s.doi).filter(Boolean)))]

// out/ is gitignored and may not exist in a fresh clone.
mkdirSync(dirname(CACHE), { recursive: true })

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
const missing = dois.filter((d) => !(d in cache))

console.log(`${dois.length} DOIs across ${claims.length} claims — ${missing.length} not cached`)

let fromCrossref = 0
let fromS2 = 0

for (const [i, doi] of missing.entries()) {
  let abstract = await crossrefAbstract(doi)
  if (abstract) fromCrossref++
  else {
    abstract = await semanticScholarAbstract(doi)
    if (abstract) fromS2++
  }
  cache[doi] = abstract
  if ((i + 1) % 20 === 0 || i === missing.length - 1) {
    console.log(`  ${i + 1}/${missing.length}`)
    writeFileSync(CACHE, JSON.stringify(cache, null, 1))
  }
}

writeFileSync(CACHE, JSON.stringify(cache, null, 1))

const have = dois.filter((d) => cache[d]).length
console.log(`\nabstracts available: ${have}/${dois.length} (${Math.round((100 * have) / dois.length)}%)`)
console.log(`  newly fetched — crossref ${fromCrossref}, semantic scholar ${fromS2}`)
console.log(`cached at ${CACHE}`)
