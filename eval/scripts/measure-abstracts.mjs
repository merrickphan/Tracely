// Re-measures the three things that were only ever tested on titles or on
// sentences I wrote myself, now against real abstracts and the hand labels.
//
// The stance number is the one that matters. The correction feature currently
// rests on twelve hand-written (finding, claim) pairs — my own sentences,
// which is close to marking my own homework. The essays' claims are ordinary
// student assertions about real topics and are broadly true, so a confident
// "contradicts" against a source a human labelled as relevant supporting
// evidence is a FALSE CONTRADICTION: exactly the output that would tell a
// student a true sentence is wrong.
//
// Limitation, stated up front: only 39 of 96 DOIs resolved to an abstract, so
// per-claim precision@3 is too thin to trust here. What is measured instead is
// per-source, over the subset that has one.

import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'

import { assertAligned, BASELINE, CACHE, REPO, reportPath } from './paths.mjs'

const REPORT = reportPath()

// Mirrors services/ml MIN_CONTRADICTION_CONFIDENCE / MIN_SUPPORT_CONFIDENCE
// and search/scoring MIN_COUNTABLE_RELEVANCE.dense, so this measures what the
// app would actually do rather than raw model output.
const MIN_CONTRADICTION_CONFIDENCE = 0.8
const MIN_SUPPORT_CONFIDENCE = 0.5
const RELEVANCE_FLOOR = 0.35

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
  const sections = []
  let current = null
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
    entries: s.labels.flatMap((l) =>
      l.text.split('·').map((t) => t.trim()).filter(Boolean).map((title) => ({ verdict: l.verdict, title }))
    )
  }))
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
      verdict: entry.verdict
    })
  }
})

console.log(`${rows.length} labelled sources WITH a real abstract, across ${new Set(rows.map(r=>r.claimIndex)).size} claims\n`)

const tf = await import(pathToFileURL(`${REPO}/node_modules/@huggingface/transformers/dist/transformers.node.mjs`).href)
const extract = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu', dtype: 'q8' })
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)

const ceTok = await tf.AutoTokenizer.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2')
const ceModel = await tf.AutoModelForSequenceClassification.from_pretrained('Xenova/ms-marco-MiniLM-L-6-v2', { device: 'cpu', dtype: 'q8' })

const nliTok = await tf.AutoTokenizer.from_pretrained('Xenova/nli-deberta-v3-xsmall')
const nliModel = await tf.AutoModelForSequenceClassification.from_pretrained('Xenova/nli-deberta-v3-xsmall', { device: 'cpu', dtype: 'q8' })
const nliLabels = nliModel.config.id2label

const byClaim = new Map()
for (const r of rows) {
  if (!byClaim.has(r.claimIndex)) byClaim.set(r.claimIndex, [])
  byClaim.get(r.claimIndex).push(r)
}

for (const [, group] of byClaim) {
  const claimText = group[0].claimText
  const withAbs = group.map((g) => `${g.title} ${g.abstract}`)
  const titleOnly = group.map((g) => g.title)

  const eA = await extract([claimText, ...withAbs], { pooling: 'mean', normalize: true })
  const dA = eA.dims[eA.dims.length - 1]
  const vA = (i) => eA.data.subarray(i * dA, (i + 1) * dA)
  const eT = await extract([claimText, ...titleOnly], { pooling: 'mean', normalize: true })
  const dT = eT.dims[eT.dims.length - 1]
  const vT = (i) => eT.data.subarray(i * dT, (i + 1) * dT)

  group.forEach((g, i) => {
    g.denseAbs = dot(vA(0), vA(i + 1))
    g.denseTitle = dot(vT(0), vT(i + 1))
  })

  const ceIn = await ceTok(Array(group.length).fill(claimText), { text_pair: withAbs, padding: true, truncation: true })
  const ceOut = await ceModel(ceIn)
  group.forEach((g, i) => { g.cross = ceOut.logits.data[i] })

  // Premise = the paper, hypothesis = the student's claim. Same direction the
  // worker uses.
  const nliIn = await nliTok(withAbs, { text_pair: Array(group.length).fill(claimText), padding: true, truncation: true })
  const { logits } = await nliModel(nliIn)
  const k = logits.dims[1]
  group.forEach((g, i) => {
    const row = Array.from(logits.data.slice(i * k, (i + 1) * k))
    const mx = Math.max(...row)
    const ex = row.map((v) => Math.exp(v - mx))
    const sum = ex.reduce((a, b) => a + b, 0)
    const probs = ex.map((v) => v / sum)
    const best = probs.indexOf(Math.max(...probs))
    const raw = String(nliLabels[best]).toLowerCase()
    let stance = raw.startsWith('entail') ? 'supports' : raw.startsWith('contradict') ? 'contradicts' : 'unclear'
    const conf = probs[best]
    if (stance === 'contradicts' && conf < MIN_CONTRADICTION_CONFIDENCE) stance = 'unclear'
    if (stance === 'supports' && conf < MIN_SUPPORT_CONFIDENCE) stance = 'unclear'
    g.stance = stance
    g.stanceConfidence = conf
  })
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const of = (v, k) => rows.filter((r) => r.verdict === v).map((r) => r[k])

console.log('1) Does the abstract help relevance? (mean score by hand label)\n')
console.log('  verdict   n     title-only   +abstract     cross-enc')
for (const v of ['rel', 'marg', 'irr']) {
  const n = rows.filter((r) => r.verdict === v).length
  if (!n) continue
  console.log(`  ${v.padEnd(8)}  ${String(n).padStart(3)}   ${mean(of(v,'denseTitle')).toFixed(3).padStart(10)}   ${mean(of(v,'denseAbs')).toFixed(3).padStart(9)}   ${mean(of(v,'cross')).toFixed(2).padStart(9)}`)
}
const sep = (k) => (mean(of('rel', k)) - mean(of('irr', k))).toFixed(3)
console.log(`\n  separation rel-vs-irr:  title-only ${sep('denseTitle')}   +abstract ${sep('denseAbs')}   cross ${(mean(of('rel','cross'))-mean(of('irr','cross'))).toFixed(2)}`)

console.log('\n\n2) STANCE — what the app would actually do\n')
console.log('  Only sources above the relevance floor are asked, as in the app.')
console.log('  hand label   n    supports  contradicts   unclear   (not asked)')
for (const v of ['rel', 'marg', 'irr']) {
  const sub = rows.filter((r) => r.verdict === v)
  if (!sub.length) continue
  const asked = sub.filter((r) => r.denseAbs >= RELEVANCE_FLOOR)
  const c = (s) => asked.filter((r) => r.stance === s).length
  console.log(`  ${v.padEnd(10)} ${String(sub.length).padStart(3)}   ${String(c('supports')).padStart(8)}  ${String(c('contradicts')).padStart(11)}  ${String(c('unclear')).padStart(8)}   ${String(sub.length - asked.length).padStart(10)}`)
}

const asked = rows.filter((r) => r.denseAbs >= RELEVANCE_FLOOR)
const flagged = asked.filter((r) => r.stance === 'contradicts')
console.log(`\n  sources reaching the stance model: ${asked.length}/${rows.length}`)
console.log(`  confident contradictions flagged:  ${flagged.length}`)
console.log(`  => a correction (paid relay call) would fire on ${new Set(flagged.map(f=>f.claimIndex)).size} of ${byClaim.size} claims`)

if (flagged.length) {
  console.log('\n  Every flagged pair, for manual inspection — these are what a student')
  console.log('  would be told about, so each one being wrong is a real harm:\n')
  for (const f of flagged) {
    console.log(`  [${f.verdict}] conf ${f.stanceConfidence.toFixed(2)}`)
    console.log(`    claim:  ${f.claimText.slice(0, 96)}`)
    console.log(`    source: ${f.title.slice(0, 96)}`)
    console.log(`    abstract: ${f.abstract.slice(0, 150)}...\n`)
  }
}
