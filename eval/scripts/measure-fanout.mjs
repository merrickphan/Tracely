// Does querying with the claim SENTENCE as well as the detected keyword query
// find papers the keyword query alone misses?
//
// The motivating failure: the Bloom/Ctrip paper is the single paper the
// remote-work claim is about, and the baseline retrieved it from no provider at
// all. No amount of reranking fixes a paper that never enters the candidate
// set.
//
// A first hypothesis — strip study-design vocabulary ("randomized controlled
// trial") so the topical words get more weight — was tested and is WRONG:
//
//   as-detected              FOUND at rank 4
//   design-words stripped    not in top 6      <- worse
//   claim text verbatim      FOUND at rank 1
//
// So this measures the variant that actually worked. Crossref only: it is free,
// unmetered, one request per query, and was the best provider in the baseline
// (45% relevant against OpenAlex's 29%). Running this costs nothing.

// More candidates can only help RECALL — a union is a superset, so the count of
// relevant papers found can never go down. The question that decides whether to
// ship this is different: after dense ranking cuts to the eight sources a
// student actually sees, does fan-out put MORE relevant papers in front of them,
// or does it flood the shortlist with near-misses and push relevant ones out?
// That is measured below, and it is the number to judge this on.

import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { assertAligned, BASELINE, REPO, reportPath } from './paths.mjs'

const REPORT = reportPath()
const MAILTO = 'info@jointracely.com'
const ROWS = 6

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const STOPWORDS = new Set(['the','a','an','and','or','but','of','to','in','on','for','with','as','is','are','was','were','be','been','being','this','that','these','those','it','its','by','from','at','into','about','than','then','so','such','not','no','can','may','might','will','would','could','should','has','have','had','we','they','their','our','more','most','also','which','who','study','studies','research','paper','article','findings','found'])
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter((w)=>w.length>2&&!STOPWORDS.has(w))
function similarity(a, b) {
  const A = new Set(norm(a)), B = new Set(norm(b))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return hit / Math.min(A.size, B.size)
}

function parseBaseline(md) {
  const sections = []; let current = null
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.startsWith('### ')) { current = { labels: [] }; sections.push(current); continue }
    if (!current) continue
    const m = line.match(/^- (rel|marg|irr):\s*(.*)$/)
    if (m) { current.labels.push({ verdict: m[1], text: m[2] }); continue }
    const last = current.labels[current.labels.length - 1]
    if (last && /^\s{2,}\S/.test(rawLine) && !line.startsWith('- ')) last.text += ' ' + line.trim()
  }
  return sections.map((s) => ({
    entries: s.labels.flatMap((l) => l.text.split('·').map((t)=>t.trim()).filter(Boolean).map((title)=>({verdict:l.verdict,title})))
  }))
}

async function crossref(query) {
  await sleep(200)
  const params = new URLSearchParams({ query, rows: String(ROWS), mailto: MAILTO })
  try {
    const res = await fetch(`https://api.crossref.org/works?${params}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.message?.items ?? []).map((it) => ({
      title: (it.title ?? [''])[0] ?? '',
      doi: (it.DOI ?? '').toLowerCase()
    })).filter((r) => r.title)
  } catch {
    return []
  }
}

const claims = Object.values(JSON.parse(readFileSync(REPORT, 'utf8'))).flatMap((e) => e.claims)
const sections = parseBaseline(readFileSync(BASELINE, 'utf8'))
assertAligned(claims, sections)

console.log(`${claims.length} claims, Crossref only, ${ROWS} rows per query — free and unmetered\n`)

let totalA = 0, totalB = 0, totalUnion = 0, totalNewFromB = 0
let relFoundA = 0, relFoundB = 0, relFoundUnion = 0
const perClaim = []

console.log('  #   keyword  +claim  union  new   rel-hits (kw -> union)')
console.log('  ' + '-'.repeat(60))

for (const [i, claim] of claims.entries()) {
  const a = await crossref(claim.searchQuery)
  const b = await crossref(claim.text)

  const key = (r) => r.doi || r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const seenA = new Set(a.map(key))
  const newFromB = b.filter((r) => !seenA.has(key(r)))
  const union = [...a, ...newFromB]

  // A retrieved paper counts as a hit if it matches a title the baseline
  // labelled 'rel' for this claim.
  const relTitles = sections[i].entries.filter((e) => e.verdict === 'rel').map((e) => e.title)
  const hits = (list) => relTitles.filter((t) => list.some((r) => similarity(r.title, t) >= 0.5)).length

  const hA = hits(a), hB = hits(b), hU = hits(union)
  totalA += a.length; totalB += b.length; totalUnion += union.length; totalNewFromB += newFromB.length
  relFoundA += hA; relFoundB += hB; relFoundUnion += hU

  perClaim.push({ claimText: claim.text, a, union, relTitles })

  const gain = hU > hA ? `  <- +${hU - hA}` : ''
  console.log(
    `  ${String(i + 1).padStart(2)}  ${String(a.length).padStart(7)}  ${String(b.length).padStart(6)}  ${String(union.length).padStart(5)}  ${String(newFromB.length).padStart(3)}   ${hA} -> ${hU}${gain}`
  )
}

// ---- what survives the cut to eight ----------------------------------------
console.log('\nranking each candidate set and cutting to 8, as the app does…\n')

const tf = await import(
  pathToFileURL(`${REPO}/node_modules/@huggingface/transformers/dist/transformers.node.mjs`).href
)
const extract = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu', dtype: 'q8' })
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)

const MAX_MERGED = 8

async function topN(claimText, candidates, n) {
  if (candidates.length === 0) return []
  const e = await extract([claimText, ...candidates.map((c) => c.title)], { pooling: 'mean', normalize: true })
  const d = e.dims[e.dims.length - 1]
  const v = (i) => e.data.subarray(i * d, (i + 1) * d)
  return candidates
    .map((c, i) => ({ ...c, score: dot(v(0), v(i + 1)) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, n)
}

let top8A = 0
let top8Union = 0

console.log('  #   rel in top-8: keyword -> fan-out')
console.log('  ' + '-'.repeat(44))

for (const [i, r] of perClaim.entries()) {
  const rankedA = await topN(r.claimText, r.a, MAX_MERGED)
  const rankedU = await topN(r.claimText, r.union, MAX_MERGED)
  const hits = (list) => r.relTitles.filter((t) => list.some((x) => similarity(x.title, t) >= 0.5)).length
  const hA = hits(rankedA)
  const hU = hits(rankedU)
  top8A += hA
  top8Union += hU
  const flag = hU > hA ? `  <- +${hU - hA}` : hU < hA ? `  <- LOST ${hA - hU}` : ''
  console.log(`  ${String(i + 1).padStart(2)}   ${hA} -> ${hU}${flag}`)
}

console.log('\n' + '='.repeat(60))
console.log(`  results, keyword query only:      ${totalA}`)
console.log(`  results, claim-sentence only:     ${totalB}`)
console.log(`  union:                            ${totalUnion}   (+${totalNewFromB} the keyword query never saw)`)
console.log()
console.log(`  hand-labelled 'rel' papers found:`)
console.log(`    keyword query only:             ${relFoundA}`)
console.log(`    claim sentence only:            ${relFoundB}`)
console.log(`    union (what fan-out gives):     ${relFoundUnion}`)
console.log('='.repeat(60))
console.log('\nNote: rel-hit counts are a floor. The baseline labelled the union of FOUR')
console.log("providers, so papers Crossref cannot reach were never labelled and can't be")
console.log('credited here. What matters is the direction and the size of the gap.')
