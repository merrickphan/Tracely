// Can a free statistics API actually answer the statistical claims students
// write? Probe before building, because the last two candidates were rejected
// only after being investigated, and the one before that (a cross-encoder) was
// nearly shipped on a statistic that measured the wrong thing.
//
// Why a separate probe set rather than eval/essays: the three labelled essays
// contain exactly two claims the router calls 'statistical', and NEITHER is
// answerable by any statistics API —
//
//   "commercial office vacancy rates in major American cities reached record
//    highs"  -> commercial real estate data is proprietary (CBRE, JLL). There
//               is no World Bank or Census indicator for it.
//   "cities that adopted printing early experienced faster economic growth"
//            -> a research finding (Dittmar 2011), not a published statistic.
//
// So the baseline cannot measure this tier at all. Adding an essay to
// eval/essays would also break the positional join with eval/baseline.md.
//
// These claims are written to be representative of what students actually
// assert with numbers, spanning what SHOULD be easy (national indicators
// tracked for decades) through to what is genuinely hard (proprietary market
// data). A provider that cannot answer the easy ones is not worth building.

import { pathToFileURL } from 'url'
import { REPO } from './paths.mjs'

// `wants` is a substring the CORRECT indicator's name must contain, or null
// when no free authoritative statistic exists and the right behaviour is
// silence.
//
// Checking the name rather than just "did it match something" is the whole
// point. An earlier version of this script scored 7/8 by counting any match as
// a success — and one of those successes paired "extreme poverty since 1990"
// with "Poverty gap at $8.30 a day", when extreme poverty is the $2.15 line.
// A plausible-but-wrong statistic under an authoritative banner is worse than
// no answer, because it is exactly the citation a student will not re-check.
const CLAIMS = [
  { text: 'The unemployment rate in the United States fell below four percent in 2023.', wants: 'Unemployment' },
  { text: 'Global life expectancy has risen by more than twenty years since 1960.', wants: 'Life expectancy' },
  { text: 'Carbon dioxide emissions per capita in the United States have declined since 2000.', wants: 'per capita' },
  { text: 'More than ninety percent of adults in South Korea use the internet.', wants: 'Internet' },
  { text: 'India overtook China as the most populous country in the world.', wants: 'Population' },
  { text: 'Access to electricity in sub-Saharan Africa remains below sixty percent.', wants: 'Access to electricity' },
  { text: 'The share of the world living in extreme poverty has fallen sharply since 1990.', wants: '$2.15' },
  { text: 'Commercial office vacancy rates in major American cities reached record highs.', wants: null }
]

// Cosine similarity above which a match is treated as a real answer rather than
// the nearest of 1,498 things. Set deliberately high: proposing the wrong
// statistic to a student is worse than proposing none, because a number with an
// authoritative-looking source attached is exactly what does not get checked.
const MATCH_FLOOR = Number(process.argv[2] ?? 0.55)

console.log('fetching World Development Indicators…')
const res = await fetch('https://api.worldbank.org/v2/indicator?format=json&source=2&per_page=2000')
const indicators = (await res.json())[1].map((x) => ({
  id: x.id,
  name: x.name,
  note: (x.sourceNote || '').slice(0, 200)
}))
console.log(`${indicators.length} indicators\n`)

const tf = await import(
  pathToFileURL(`${REPO}/node_modules/@huggingface/transformers/dist/transformers.node.mjs`).href
)
const extract = await tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu', dtype: 'q8' })
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)

// Embedded in batches; the indicator set is fixed so in a real provider this
// would be computed once and cached, not per query.
console.log('embedding indicator names…')
const vectors = []
const BATCH = 256
for (let i = 0; i < indicators.length; i += BATCH) {
  const slice = indicators.slice(i, i + BATCH)
  const e = await extract(slice.map((x) => x.name), { pooling: 'mean', normalize: true })
  const d = e.dims[e.dims.length - 1]
  for (let j = 0; j < slice.length; j++) vectors.push(e.data.slice(j * d, (j + 1) * d))
}
console.log('done\n')

console.log(`  match floor ${MATCH_FLOOR}\n`)
console.log('  verdict      score  claim -> best matching indicator')
console.log('  ' + '-'.repeat(94))

let right = 0
let silent = 0
let wrong = 0
for (const claim of CLAIMS) {
  const e = await extract([claim.text], { pooling: 'mean', normalize: true })
  const v = e.data.slice(0, e.dims[e.dims.length - 1])
  let best = -1
  let bestScore = -1
  vectors.forEach((iv, i) => {
    const s = dot(v, iv)
    if (s > bestScore) { bestScore = s; best = i }
  })

  const matched = bestScore >= MATCH_FLOOR
  const name = indicators[best].name

  // Three outcomes, not two, because they carry very different costs:
  //   RIGHT  — offered the correct indicator
  //   silent — offered nothing (a miss; costs the student nothing)
  //   WRONG  — offered an indicator that does not measure the claim
  let verdict
  if (!matched) {
    verdict = 'silent'
    silent++
  } else if (claim.wants && name.includes(claim.wants)) {
    verdict = 'RIGHT'
    right++
  } else {
    verdict = 'WRONG'
    wrong++
  }

  console.log(`  ${verdict.padEnd(11)} ${bestScore.toFixed(3)}  ${claim.text.slice(0, 56)}`)
  console.log(`                     -> ${matched ? name.slice(0, 72) : '(below floor — no answer offered)'}`)
}

console.log(`\n  right: ${right}   silent: ${silent}   WRONG: ${wrong}    (floor ${MATCH_FLOOR})`)
console.log('\n  These are not equal-weight. A miss costs the student nothing — the academic')
console.log('  providers still ran. A wrong statistic under an authoritative banner is the')
console.log('  citation they will not re-check, so the floor should be set to drive WRONG')
console.log('  to zero even at the cost of several misses.')
