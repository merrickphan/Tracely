// Does the claim-type router send each claim somewhere useful?
//
// Routing that misfires is worse than no routing: it spends requests, takes
// evidence slots, and does it invisibly. The previous binary version was
// measured on exactly one threshold case (a travel-agency RCT that reads
// medical and is about remote work). This checks all 13 labelled claims and
// prints the margins, so a threshold change is a decision rather than a guess.
//
// Runs entirely locally against the embedding model. No network, no quota.

import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { REPO, reportPath } from './paths.mjs'

const REPORT = reportPath()

const ANCHORS = {
  biomedical: [
    'a clinical study of human health, disease, medicine, or physiology',
    'research on sleep, nutrition, mental health, or the human body',
    'a medical trial measuring a health outcome in patients'
  ],
  statistical: [
    'an official statistic about an economy, population, or labour market',
    'a measured rate, percentage, or index published by a government agency',
    'national data on employment, prices, housing, trade, or development'
  ],
  general: [
    'a historical fact, date, or definition of a well-known thing',
    'a description of who someone was or what an organisation does',
    'general background knowledge found in an encyclopedia'
  ]
}
const ORDER = ['biomedical', 'statistical', 'general']
// Keep in sync with domainRouter.ts. Override from the command line to compare
// thresholds: `node eval/scripts/measure-routing.mjs "" 0.03`
const DOMAIN_MARGIN = Number(process.argv[3] ?? 0.05)

const claims = Object.values(JSON.parse(readFileSync(REPORT, 'utf8'))).flatMap((e) => e.claims)

const tf = await import(
  pathToFileURL(`${REPO}/node_modules/@huggingface/transformers/dist/transformers.node.mjs`).href
)
const extract = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu', dtype: 'q8' })
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)

const flat = ORDER.flatMap((d) => ANCHORS[d])

console.log(`routing ${claims.length} labelled claims\n`)
console.log('  domain       margin  claim')
console.log('  ' + '-'.repeat(86))

const counts = { biomedical: 0, statistical: 0, general: 0, scholarly: 0 }

for (const claim of claims) {
  const subject = `${claim.text} ${claim.query ?? ''}`.trim()
  const e = await extract([...flat, subject], { pooling: 'mean', normalize: true })
  const d = e.dims[e.dims.length - 1]
  const vec = (i) => e.data.subarray(i * d, (i + 1) * d)
  const subjectVector = vec(flat.length)
  const scores = flat.map((_, i) => dot(vec(i), subjectVector))

  let offset = 0
  const byDomain = ORDER.map((domain) => {
    const size = ANCHORS[domain].length
    const best = Math.max(...scores.slice(offset, offset + size))
    offset += size
    return { domain, best }
  }).sort((a, b) => b.best - a.best)

  const [winner, runnerUp] = byDomain
  const margin = winner.best - runnerUp.best
  const decided = margin > DOMAIN_MARGIN ? winner.domain : 'scholarly'
  counts[decided]++

  const flag = decided === 'scholarly' ? ' ' : '>'
  console.log(
    `${flag} ${decided.padEnd(12)} ${margin.toFixed(3).padStart(6)}  ${claim.text.slice(0, 64)}`
  )
}

console.log('\nrouted to:')
for (const [domain, n] of Object.entries(counts)) {
  const extra =
    domain === 'biomedical' ? '  (+ PubMed)' : domain === 'general' ? '  (+ Wikipedia)' : domain === 'statistical' ? '  (no provider yet)' : '  (academic only)'
  console.log(`  ${domain.padEnd(12)} ${String(n).padStart(2)}${extra}`)
}
console.log(
  '\nEvery claim still queries the academic providers. Routing only decides what runs\nIN ADDITION, so a misroute costs a request, never a source.'
)
