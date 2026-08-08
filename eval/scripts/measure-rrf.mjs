// Should a cross-encoder rerank the candidate list? Measured answer: no.
//
// Written to validate shipping Xenova/ms-marco-MiniLM-L-6-v2 as a reranker, on
// the strength of an earlier run where it separated the hand labels far better
// than the bi-encoder. It does not survive this measurement, and the reranker
// was not shipped. The numbers, and the reasoning, are recorded in
// src/main/services/ml/protocol.ts.
//
// The methodological trap is the reason this file exists. That earlier run
// compared MEAN SCORE per hand label, pooled across all claims. A reranker only
// ever orders candidates WITHIN a single claim, so a pooled separation can look
// excellent while the orderings it actually produces are worse — which is
// exactly what happened. Measure the ordering, not a scale nobody uses.
//
// Metric is pairwise concordance, not precision@3. Only 38 labelled sources
// have abstracts, spread over 12 claims — barely 3 per claim, so "precision in
// the top 3" would cover almost the whole list and measure nothing. Concordance
// asks the question that actually matters for an ordering: given two sources
// for the same claim with different hand labels, how often does the ranker put
// the better one first? It is well defined at any list length.

import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'

import { assertAligned, BASELINE, CACHE, REPO, reportPath } from './paths.mjs'

const REPORT = reportPath()

const RRF_K = 10
const PER_PROVIDER_LIMIT = 6

const RANK = { rel: 2, marg: 1, irr: 0 }

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
  return sections.map((s) => ({ entries: s.labels.flatMap((l) => l.text.split('·').map((t)=>t.trim()).filter(Boolean).map((title)=>({verdict:l.verdict,title}))) }))
}

const abstracts = JSON.parse(readFileSync(CACHE, 'utf8'))
const claims = Object.values(JSON.parse(readFileSync(REPORT, 'utf8'))).flatMap((e) => e.claims)
const sections = parseBaseline(readFileSync(BASELINE, 'utf8'))
assertAligned(claims, sections)

const rows = []
claims.forEach((claim, ci) => {
  const entries = [...sections[ci].entries]
  for (const source of claim.sources) {
    let best = -1, bestScore = 0
    entries.forEach((e, k) => { const s = similarity(source.title, e.title); if (s > bestScore) { bestScore = s; best = k } })
    if (best === -1 || bestScore < 0.34) continue
    const [entry] = entries.splice(best, 1)
    const abstract = source.doi ? abstracts[source.doi] : null
    if (!abstract) continue
    rows.push({
      claimIndex: ci,
      claimText: claim.text,
      title: source.title,
      abstract,
      relevanceRank: source.rank ?? 0,
      verdict: entry.verdict
    })
  }
})

const byClaim = new Map()
for (const r of rows) { if (!byClaim.has(r.claimIndex)) byClaim.set(r.claimIndex, []); byClaim.get(r.claimIndex).push(r) }

// Claims where every source carries the same label produce no comparable pairs.
const usable = [...byClaim.values()].filter((g) => new Set(g.map((r) => r.verdict)).size > 1)
console.log(`${rows.length} labelled sources with abstracts; ${usable.length} of ${byClaim.size} claims have mixed labels and so can be scored\n`)

const tf = await import(pathToFileURL(`${REPO}/node_modules/@huggingface/transformers/dist/transformers.node.mjs`).href)
const extract = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu', dtype: 'q8' })
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
const ceTok = await tf.AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2')
const ceModel = await tf.AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { device: 'cpu', dtype: 'q8' })

let totalMs = 0
for (const group of usable) {
  const claimText = group[0].claimText
  const passages = group.map((g) => `${g.title} ${g.abstract}`)

  const e = await extract([claimText, ...passages], { pooling: 'mean', normalize: true })
  const d = e.dims[e.dims.length - 1]
  group.forEach((g, i) => {
    g.dense = dot(e.data.subarray(0, d), e.data.subarray((i + 1) * d, (i + 2) * d))
    // Mirrors aggregator.blendedRelevance, which is what actually orders the
    // shortlist handed to the reranker.
    const rankRelevance = Math.max(0, Math.min(1, 1 - g.relevanceRank / PER_PROVIDER_LIMIT))
    g.blended = 0.75 * g.dense + 0.25 * rankRelevance
  })

  const started = process.hrtime.bigint()
  const inputs = await ceTok(passages.map(() => claimText), { text_pair: passages, padding: true, truncation: true })
  const out = await ceModel(inputs)
  totalMs += Number(process.hrtime.bigint() - started) / 1e6
  group.forEach((g, i) => { g.cross = out.logits.data[i] })
}

function orderBy(group, key) {
  return [...group].sort((a, b) => b[key] - a[key])
}
function rankMap(ordered) {
  const m = new Map()
  ordered.forEach((g, i) => m.set(g, i))
  return m
}

// Reciprocal Rank Fusion of the two orderings — the form the reranker would
// have shipped in, had it earned its place: fuse by RANK rather than by score,
// because cosine and unbounded logits are incommensurable and any weighted sum
// of them is a hidden calibration.
function fused(group) {
  const denseRank = rankMap(orderBy(group, 'blended'))
  const crossRank = rankMap(orderBy(group, 'cross'))
  return [...group].sort(
    (a, b) =>
      1 / (RRF_K + crossRank.get(b)) + 1 / (RRF_K + denseRank.get(b)) -
      (1 / (RRF_K + crossRank.get(a)) + 1 / (RRF_K + denseRank.get(a)))
  )
}

function concordance(orderings) {
  let agree = 0, total = 0, tied = 0
  for (const ordered of orderings) {
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const better = RANK[ordered[i].verdict], worse = RANK[ordered[j].verdict]
        if (better === worse) continue
        total++
        if (better > worse) agree++
        else if (better === worse) tied++
      }
    }
  }
  return { agree, total, tied, pct: total ? agree / total : 0 }
}

const variants = {
  'provider rank only': usable.map((g) => [...g].sort((a, b) => a.relevanceRank - b.relevanceRank)),
  'bi-encoder (what ships)': usable.map((g) => orderBy(g, 'blended')),
  'cross-encoder alone': usable.map((g) => orderBy(g, 'cross')),
  'RRF fusion (rejected)': usable.map(fused)
}

console.log('Pairwise concordance — of all label-differing pairs within a claim,')
console.log('how often the ranker puts the better-labelled source first.\n')
console.log('  ordering                        concordance      pairs')
for (const [name, orderings] of Object.entries(variants)) {
  const c = concordance(orderings)
  console.log(`  ${name.padEnd(30)}  ${(100 * c.pct).toFixed(1).padStart(9)}%  ${String(c.total).padStart(9)}`)
}

// Top-1 is what a student's eye lands on first, so it is worth its own number.
console.log('\nTop result by hand label:\n')
console.log('  ordering                          rel    marg     irr')
for (const [name, orderings] of Object.entries(variants)) {
  const tops = orderings.map((o) => o[0].verdict)
  const c = (v) => tops.filter((t) => t === v).length
  console.log(`  ${name.padEnd(30)}  ${String(c('rel')).padStart(5)}  ${String(c('marg')).padStart(6)}  ${String(c('irr')).padStart(6)}`)
}

// The claim that justified shipping this was specifically about rel-vs-marg —
// the distinction the pooled means said the bi-encoder could not make. If that
// claim is right, it shows up in this breakdown or nowhere.
console.log('\nConcordance by pair type:\n')
const PAIR_TYPES = [['rel', 'irr'], ['rel', 'marg'], ['marg', 'irr']]
console.log('  ordering                        rel/irr   rel/marg   marg/irr')
for (const [name, orderings] of Object.entries(variants)) {
  const cells = PAIR_TYPES.map(([hi, lo]) => {
    let agree = 0, total = 0
    for (const ordered of orderings) {
      for (let i = 0; i < ordered.length; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          const a = ordered[i].verdict, b = ordered[j].verdict
          if (!((a === hi && b === lo) || (a === lo && b === hi))) continue
          total++
          if (a === hi) agree++
        }
      }
    }
    return total ? `${(100 * agree / total).toFixed(0)}% (${total})` : '—'
  })
  console.log(`  ${name.padEnd(30)}  ${cells[0].padStart(7)}   ${cells[1].padStart(8)}   ${cells[2].padStart(8)}`)
}

// One pair either way is the whole gap between these variants at this sample
// size, so the disagreements are worth naming individually rather than trusting
// a percentage built from 30 comparisons.
console.log('\nPairs the bi-encoder gets right and the fusion gets wrong:\n')
const denseOrders = variants['bi-encoder (what ships)']
const fusedOrders = variants['RRF fusion (rejected)']
for (let g = 0; g < denseOrders.length; g++) {
  const pos = (ordered) => new Map(ordered.map((r, i) => [r, i]))
  const dp = pos(denseOrders[g]), fp = pos(fusedOrders[g])
  for (const a of denseOrders[g]) {
    for (const b of denseOrders[g]) {
      if (RANK[a.verdict] <= RANK[b.verdict]) continue
      const denseRight = dp.get(a) < dp.get(b)
      const fusedRight = fp.get(a) < fp.get(b)
      if (denseRight && !fusedRight) {
        console.log(`  claim: ${a.claimText.slice(0, 84)}`)
        console.log(`    [${a.verdict}] demoted below [${b.verdict}]`)
        console.log(`      ${a.verdict}: ${a.title.slice(0, 80)}  (dense ${a.dense.toFixed(3)}, cross ${a.cross.toFixed(2)})`)
        console.log(`      ${b.verdict}: ${b.title.slice(0, 80)}  (dense ${b.dense.toFixed(3)}, cross ${b.cross.toFixed(2)})\n`)
      }
    }
  }
}

console.log(`\nCross-encoder cost: ${(totalMs / usable.length).toFixed(0)}ms per claim (${usable.length} claims, ${rows.length} pairs total)`)
console.log('Latency was never the objection — quality was. Cost is recorded only so a')
console.log('future scientific-domain reranker can be compared against a known figure.')
