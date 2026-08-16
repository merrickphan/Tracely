// Is the stance model broken, or is it being asked the wrong question?
//
// `support` carries the heaviest weight in computeStrengthScore (0.4) and
// contributes nothing: whole-abstract classification returned `unclear` for all
// 21 sources it was asked about on the labelled baseline. The conclusion drawn
// from that was "replace nli-deberta-v3-xsmall with something fine-tuned on
// SciFact", which is a week of work and a packaging change.
//
// eval/scripts/stance-sentence.mjs wrote down a cheaper hypothesis and was
// never run — no result for it exists anywhere in the repo. It says: the
// GRANULARITY is wrong. NLI models are trained on short premise/hypothesis
// pairs, and SciFact itself pairs a claim with a single rationale SENTENCE. A
// 1000-character abstract spanning background, methods, results and limitations
// entails almost nothing in particular, so `neutral` is the honest answer and
// the model is behaving correctly.
//
// This runs both granularities over the same sources and scores them against
// the hand labels in labels-2026-08-10.json. It answers, before any model is
// swapped: does the current model produce usable verdicts when asked one
// sentence at a time?
//
// Local models, no network, no relay. Slow — a few thousand CPU classifications.
//
//   node eval/retrieval/stance.mjs

import { readFileSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

// The app's own bars, from services/ml. Contradiction is held to a higher one
// because telling a student their claim is contradicted is the most alarming
// thing this product can say.
const MIN_CONTRADICTION_CONFIDENCE = 0.8
const MIN_SUPPORT_CONFIDENCE = 0.5
// The floor as calibrated on 2026-08-16 — see MIN_COUNTABLE_RELEVANCE.
const RELEVANCE_FLOOR = 0.42

const labels = JSON.parse(readFileSync(`${HERE}/labels-2026-08-10.json`, 'utf8'))
const report = JSON.parse(readFileSync(`${REPO}/eval/reports/${labels.report}`, 'utf8'))
const flat = report.flatMap((essay) => essay.claims)

// Structured abstracts carry "RESULTS:" / "CONCLUSIONS:" labels, and those are
// exactly the sentences a fact-check needs, so the split keeps them attached.
function sentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 600)
    .slice(0, 12)
}

const rows = []
for (const labelled of labels.claims) {
  const claim = flat.find((c) => c.text.startsWith(labelled.claim))
  claim.sources.forEach((source, i) => {
    // Joined by position WITHIN one claim's source list, which is the one place
    // a positional join is safe: the verdicts were written from this report's
    // own rank order and rank.mjs asserts the two lengths agree.
    if (!source.abstract) return
    if (source.textRelevance < RELEVANCE_FLOOR) return
    rows.push({
      claimText: claim.text,
      verdict: labelled.verdicts[i],
      title: source.title,
      abstract: source.abstract
    })
  })
}

const tf = await import(
  pathToFileURL(`${REPO}/node_modules/@huggingface/transformers/dist/transformers.node.mjs`).href
)
const tok = await tf.AutoTokenizer.from_pretrained('Xenova/nli-deberta-v3-xsmall')
const model = await tf.AutoModelForSequenceClassification.from_pretrained('Xenova/nli-deberta-v3-xsmall', {
  device: 'cpu',
  dtype: 'q8'
})
const id2label = model.config.id2label

/** Premise = the source text, hypothesis = the claim. That direction is the
 *  one NLI is trained on and the one SciFact uses: does this passage entail
 *  this claim. */
async function classify(premises, hypothesis) {
  const inputs = await tok(premises, {
    text_pair: premises.map(() => hypothesis),
    padding: true,
    truncation: true
  })
  const { logits } = await model(inputs)
  const k = logits.dims[1]
  return premises.map((_, i) => {
    const row = Array.from(logits.data.slice(i * k, (i + 1) * k))
    const max = Math.max(...row)
    const exp = row.map((v) => Math.exp(v - max))
    const sum = exp.reduce((a, b) => a + b, 0)
    const probs = exp.map((v) => v / sum)
    const best = probs.indexOf(Math.max(...probs))
    const raw = String(id2label[best]).toLowerCase()
    return {
      stance: raw.startsWith('entail') ? 'supports' : raw.startsWith('contradict') ? 'contradicts' : 'unclear',
      confidence: probs[best]
    }
  })
}

const decisive = (v) =>
  (v.stance === 'contradicts' && v.confidence >= MIN_CONTRADICTION_CONFIDENCE) ||
  (v.stance === 'supports' && v.confidence >= MIN_SUPPORT_CONFIDENCE)

process.stdout.write(`asking ${rows.length} sources, two ways`)
for (const row of rows) {
  process.stdout.write('.')

  // 1. What ships today: the whole abstract as one premise.
  const [whole] = await classify([row.abstract], row.claimText)
  row.whole = decisive(whole) ? whole : { stance: 'unclear', confidence: whole.confidence }

  // 2. The hypothesis: one sentence at a time, most confident decisive verdict
  //    wins. A single sentence in a paper's results IS the rationale, which is
  //    the unit NLI was trained on.
  const sents = sentences(row.abstract)
  row.sentence = { stance: 'unclear', confidence: 0, text: null }
  if (sents.length) {
    const verdicts = await classify(sents, row.claimText)
    verdicts.forEach((v, i) => {
      if (decisive(v) && v.confidence > row.sentence.confidence) {
        row.sentence = { ...v, text: sents[i] }
      }
    })
  }
}
console.log('\n')

const table = (name, pick) => {
  console.log(`${name}`)
  console.log('  hand label    n   supports  contradicts   unclear')
  for (const v of ['rel', 'marg', 'irr']) {
    const sub = rows.filter((r) => r.verdict === v)
    if (!sub.length) continue
    const count = (s) => sub.filter((r) => pick(r).stance === s).length
    console.log(
      `  ${v.padEnd(11)} ${String(sub.length).padStart(3)}  ${String(count('supports')).padStart(9)}` +
        `  ${String(count('contradicts')).padStart(11)}  ${String(count('unclear')).padStart(8)}`
    )
  }
  const decided = rows.filter((r) => pick(r).stance !== 'unclear')
  console.log(`  decisive verdicts: ${decided.length}/${rows.length}`)
  // The number that matters. A stance signal is only worth its 0.4 weight if it
  // says "supports" about evidence more often than about noise.
  const rate = (v) => {
    const sub = rows.filter((r) => r.verdict === v)
    return sub.length ? (100 * sub.filter((r) => pick(r).stance === 'supports').length) / sub.length : NaN
  }
  console.log(`  supports rate: rel ${rate('rel').toFixed(0)}%  marg ${rate('marg').toFixed(0)}%  irr ${rate('irr').toFixed(0)}%\n`)
}

table('WHOLE ABSTRACT (what ships today)', (r) => r.whole)
table('SENTENCE LEVEL (the untested hypothesis)', (r) => r.sentence)

const found = rows.filter((r) => r.sentence.stance === 'supports')
if (found.length) {
  console.log('Sample rationale sentences it located:\n')
  for (const r of found.slice(0, 5)) {
    console.log(`  [${r.verdict}] conf ${r.sentence.confidence.toFixed(2)}`)
    console.log(`    claim:    ${r.claimText.slice(0, 96)}`)
    console.log(`    sentence: ${r.sentence.text.slice(0, 150)}\n`)
  }
}
const contra = rows.filter((r) => r.sentence.stance === 'contradicts')
if (contra.length) {
  console.log('CONTRADICTIONS — every one of these would be shown to a student:\n')
  for (const r of contra) {
    console.log(`  [${r.verdict}] conf ${r.sentence.confidence.toFixed(2)}`)
    console.log(`    claim:    ${r.claimText.slice(0, 96)}`)
    console.log(`    sentence: ${r.sentence.text.slice(0, 150)}\n`)
  }
}
