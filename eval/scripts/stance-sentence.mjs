// Whole-abstract stance returned "unclear" for all 21 sources it was asked
// about — zero contradictions, but also zero supports. Safe, and useless: with
// support weighted 0.4 in the new score, a support factor that is always 0
// caps every claim near 60 no matter how well evidenced it is.
//
// Hypothesis: the granularity is wrong. NLI models are trained on short
// premise/hypothesis pairs, and SciFact — the dataset the plan proposes
// fine-tuning on — pairs a claim with the specific RATIONALE SENTENCE, not a
// whole abstract. A 1500-character abstract covering methods, results and
// limitations against one 25-word sentence is a premise that entails almost
// nothing in particular, so "neutral" is the honest answer.
//
// This tests sentence-level: split the abstract, classify each sentence, keep
// the most confident non-neutral verdict.

import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'

import { assertAligned, BASELINE, CACHE, REPO, reportPath } from './paths.mjs'

const REPORT = reportPath()

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

// Structured abstracts carry "RESULTS:" / "CONCLUSIONS:" labels; those are
// exactly the sentences a fact-check needs, so the split keeps them attached.
function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 600)
    .slice(0, 12)
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
    rows.push({ claimIndex: ci, claimText: claim.text, title: source.title, abstract, verdict: entry.verdict })
  }
})

const tf = await import(pathToFileURL(`${REPO}/node_modules/@huggingface/transformers/dist/transformers.node.mjs`).href)
const extract = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu', dtype: 'q8' })
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0)
const nliTok = await tf.AutoTokenizer.from_pretrained('Xenova/nli-deberta-v3-xsmall')
const nliModel = await tf.AutoModelForSequenceClassification.from_pretrained('Xenova/nli-deberta-v3-xsmall', { device:'cpu', dtype:'q8' })
const labels = nliModel.config.id2label

async function classify(premises, hypothesis) {
  const inputs = await nliTok(premises, { text_pair: premises.map(()=>hypothesis), padding:true, truncation:true })
  const { logits } = await nliModel(inputs)
  const k = logits.dims[1]
  return premises.map((_, i) => {
    const row = Array.from(logits.data.slice(i*k,(i+1)*k))
    const mx = Math.max(...row); const ex = row.map(v=>Math.exp(v-mx)); const sum = ex.reduce((a,b)=>a+b,0)
    const probs = ex.map(v=>v/sum); const best = probs.indexOf(Math.max(...probs))
    const raw = String(labels[best]).toLowerCase()
    return { stance: raw.startsWith('entail')?'supports':raw.startsWith('contradict')?'contradicts':'unclear', confidence: probs[best] }
  })
}

// Relevance gate, same as the app.
const byClaim = new Map()
for (const r of rows) { if (!byClaim.has(r.claimIndex)) byClaim.set(r.claimIndex, []); byClaim.get(r.claimIndex).push(r) }
for (const [, group] of byClaim) {
  const e = await extract([group[0].claimText, ...group.map(g=>`${g.title} ${g.abstract}`)], { pooling:'mean', normalize:true })
  const d = e.dims[e.dims.length-1]
  group.forEach((g,i)=>{ g.relevance = dot(e.data.subarray(0,d), e.data.subarray((i+1)*d,(i+2)*d)) })
}

const asked = rows.filter((r) => r.relevance >= RELEVANCE_FLOOR)

for (const r of asked) {
  const sents = sentences(r.abstract)
  if (!sents.length) { r.stance = 'unclear'; r.confidence = 0; continue }
  const verdicts = await classify(sents, r.claimText)

  // Most confident decisive verdict wins; contradictions must clear the
  // higher bar, exactly as in services/ml.
  let best = { stance: 'unclear', confidence: 0, sentence: null }
  verdicts.forEach((v, i) => {
    const passes =
      (v.stance === 'contradicts' && v.confidence >= MIN_CONTRADICTION_CONFIDENCE) ||
      (v.stance === 'supports' && v.confidence >= MIN_SUPPORT_CONFIDENCE)
    if (passes && v.confidence > best.confidence) best = { ...v, sentence: sents[i] }
  })
  r.stance = best.stance
  r.confidence = best.confidence
  r.sentence = best.sentence
}

console.log(`sentence-level stance over ${asked.length} sources above the relevance floor\n`)
console.log('  hand label    n    supports  contradicts   unclear')
for (const v of ['rel','marg','irr']) {
  const sub = asked.filter(r=>r.verdict===v)
  if (!sub.length) continue
  const c = (s) => sub.filter(r=>r.stance===s).length
  console.log(`  ${v.padEnd(11)} ${String(sub.length).padStart(3)}   ${String(c('supports')).padStart(8)}  ${String(c('contradicts')).padStart(11)}  ${String(c('unclear')).padStart(8)}`)
}

const contra = asked.filter(r=>r.stance==='contradicts')
const supp = asked.filter(r=>r.stance==='supports')
console.log(`\n  supports found:      ${supp.length}   (whole-abstract found 0)`)
console.log(`  contradictions:      ${contra.length}`)

if (supp.length) {
  console.log('\n  Sample supporting sentences it located:\n')
  for (const s of supp.slice(0,4)) {
    console.log(`  [${s.verdict}] conf ${s.confidence.toFixed(2)}`)
    console.log(`    claim:    ${s.claimText.slice(0,92)}`)
    console.log(`    sentence: ${(s.sentence||'').slice(0,140)}\n`)
  }
}
if (contra.length) {
  console.log('\n  CONTRADICTIONS — each would be shown to a student:\n')
  for (const s of contra) {
    console.log(`  [${s.verdict}] conf ${s.confidence.toFixed(2)}`)
    console.log(`    claim:    ${s.claimText.slice(0,92)}`)
    console.log(`    sentence: ${(s.sentence||'').slice(0,140)}\n`)
  }
}
