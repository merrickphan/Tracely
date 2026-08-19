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

// The anchors are READ OUT OF domainRouter.ts, not copied here.
//
// They were a duplicate, under a "keep in sync with domainRouter.ts" comment,
// and on 2026-08-19 that comment was the only thing keeping them in sync — a
// change to the module's anchors was measured against this file's stale copy
// and reported as "no regressions" for a router it had never run. A comment is
// not a mechanism. Parsing the source is ugly and it cannot silently disagree.
const ROUTER_SRC = readFileSync(`${REPO}/src/main/services/search/domainRouter.ts`, 'utf8')
const anchorBlock = ROUTER_SRC.slice(
  ROUTER_SRC.indexOf('const ANCHORS'),
  ROUTER_SRC.indexOf('const DOMAIN_MARGIN')
)
const ANCHORS = Object.fromEntries(
  ['biomedical', 'statistical', 'general'].map((domain) => {
    const at = anchorBlock.indexOf(`${domain}: [`)
    if (at === -1) throw new Error(`no ${domain} anchors in domainRouter.ts`)
    const body = anchorBlock.slice(at, anchorBlock.indexOf(']', at))
    // The anchors are plain single-quoted prose with no escapes in them, so a
    // non-greedy literal match is enough and avoids an escape-handling regex
    // that would be one more thing to get subtly wrong.
    const found = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
    if (found.length === 0) throw new Error(`no ${domain} anchor strings parsed`)
    return [domain, found]
  })
)
console.log(
  `anchors from domainRouter.ts: ` +
    Object.entries(ANCHORS)
      .map(([d, a]) => `${d} ${a.length}`)
      .join(', ')
)
const ORDER = ['biomedical', 'statistical', 'general']
// Keep in sync with domainRouter.ts. Override from the command line to compare
// thresholds: `node eval/scripts/measure-routing.mjs "" 0.03`
const DOMAIN_MARGIN = Number(process.argv[3] ?? 0.05)

const claims = Object.values(JSON.parse(readFileSync(REPORT, 'utf8'))).flatMap((e) => e.claims)

// Biography claims from the owner's Audrey Hepburn draft, 2026-08-19. Not in
// the labelled report — they are here because they are the failure that
// motivated the biography anchors, and a routing change that fixes them has to
// be visible in the same place a routing regression would be. Marked so nobody
// mistakes them for labelled data.
if (process.env.WITH_BIOGRAPHY) {
  claims.push(
    {
      text: 'She had largely contributed to the resistance by participating in underground activities such as delivering newspapers and taking messages and food to downed Allied flyers.',
      searchQuery: 'Audrey Hepburn underground activities Dutch resistance',
      unlabelled: true
    },
    {
      text: 'She also volunteered in a hospital that was involved with resistance activity.',
      searchQuery: 'Audrey Hepburn hospital resistance activity',
      unlabelled: true
    },
    {
      text: 'She devolved anemia, respiratory difficulties',
      searchQuery: 'Audrey Hepburn anemia respiratory malnutrition',
      unlabelled: true
    }
  )
}

const tf = await import(
  pathToFileURL(`${REPO}/node_modules/@huggingface/transformers/dist/transformers.node.mjs`).href
)
const extract = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu', dtype: 'q8' })
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)

const flat = ORDER.flatMap((d) => ANCHORS[d])

const labelledCount = claims.filter((c) => !c.unlabelled).length
console.log(
  `routing ${labelledCount} labelled claims` +
    (claims.length > labelledCount
      ? ` + ${claims.length - labelledCount} unlabelled biography claims`
      : '') +
    '\n'
)
console.log('  domain       margin  claim')
console.log('  ' + '-'.repeat(86))

const counts = { biomedical: 0, statistical: 0, general: 0, scholarly: 0 }

for (const claim of claims) {
  // searchQuery, not query. The first version of this script read `claim.query`,
  // which does not exist in the report — so it silently measured the router on
  // claim text alone while the app feeds it claim text PLUS the query. The
  // threshold set from that run was calibrated on the wrong input.
  const subject = `${claim.text} ${claim.searchQuery ?? ''}`.trim()
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

  // Unlabelled rows are marked so a reader never counts them as evidence of
  // routing quality — they are a fixture for one known failure.
  const flag = claim.unlabelled ? '?' : decided === 'scholarly' ? ' ' : '>'
  console.log(
    `${flag} ${decided.padEnd(12)} ${margin.toFixed(3).padStart(6)}  ${claim.text.slice(0, 64)}`
  )
}

console.log('\nrouted to:')
for (const [domain, n] of Object.entries(counts)) {
  const extra =
    domain === 'biomedical' ? '  (+ PubMed)' : domain === 'general' ? '  (+ Wikipedia)' : domain === 'statistical' ? '  (+ World Bank)' : '  (academic only)'
  console.log(`  ${domain.padEnd(12)} ${String(n).padStart(2)}${extra}`)
}
console.log(
  '\nEvery claim still queries the academic providers. Routing only decides what runs\nIN ADDITION, so a misroute costs a request, never a source.'
)
