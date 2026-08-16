// Can the reference list be read without inventing an author?
//
// "[3]" and "(Shoup 45)" name nobody. The authors, the year and the title live
// in a list at the end of the document, so the fabrication check either reads
// that list or covers no IEEE and no MLA draft at all — which is what it did
// until now, making coverage a function of the writer's citation style rather
// than of anything about the citation.
//
// Reading it moves the risk. The LOOKUP is already measured (eval/fabrication:
// 0 false alarms over 36 real references, 0 corroborations over 10 invented
// pairs) and none of that changes here. What is new is the parse, and the parse
// has one failure mode that matters:
//
//   HARM   a surname the entry does not actually list — a title word taken for
//          an author. `corroborate` requires EVERY listed surname on one work,
//          so an invented one makes corroboration impossible; if the entry also
//          carries a year, that is reported as absence, and absence is the
//          accusation. This number must be zero.
//
//   LOSS   an author the parse missed. Safe in the only direction that counts:
//          fewer required surnames makes corroboration EASIER. Worth counting
//          so it is not mistaken for correctness, but it does not gate.
//
// The corpus is generated rather than collected, on purpose. The 46 labelled
// references in eval/fabrication carry known surnames and years, so rendering
// each one into IEEE, MLA and APA gives a set where the right answer is known
// exactly — and the titles are written to be ADVERSARIAL, full of " and " and
// capitalised words, because "Deep Learning and Neural Networks" sitting where
// an author list should be is precisely how a parser invents an author.
//
//   node eval/bibliography/run.mjs
//   node eval/bibliography/run.mjs --verbose   # every case, not just failures
//
// Free and offline: no network, no relay, no cache. Re-run it after any change
// to bibliography.ts.

import { readFileSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'

const REPO = fileURLToPath(new URL('../..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

// The real module, imported rather than reimplemented — a copy of the patterns
// here would drift and then measure itself.
const { parseBibliography, bibliographyReferences } = await import(
  pathToFileURL(`${REPO}/src/shared/bibliography.ts`).href
)
const { absenceIsInformative, isCheckable } = await import(
  pathToFileURL(`${REPO}/src/shared/citedReference.ts`).href
)

const verbose = process.argv.includes('--verbose')

const labelled = JSON.parse(
  readFileSync(`${REPO}/eval/fabrication/references.json`, 'utf8')
).references

// Deterministic given names, so a re-run produces the same corpus and the same
// numbers. Their content is irrelevant; their SHAPE is the test.
const GIVEN = ['Amara', 'Bernard', 'Chandra', 'Dmitri', 'Elena', 'Farouk']
const initial = (i) => `${GIVEN[i % GIVEN.length][0]}.`

// Titles built to break an author parser: each contains " and ", each is a run
// of capitalised words, and each would yield a plausible-looking surname if the
// parser ever mistook it for a name.
const TITLES = [
  'Neural Networks and Statistical Learning',
  'Memory and Attention in Adolescence',
  'The Economics of Housing and Land Use',
  'Risk Perception and Public Policy',
  'Language Models and Human Judgement',
  'Sleep Timing and Academic Performance'
]
const titleFor = (i) => TITLES[i % TITLES.length]

const VENUE = 'Journal of Applied Research'

function ieeeQuoted(ref, n, i) {
  const authors = ref.surnames.map((s, k) => `${initial(k)} ${s}`).join(' and ')
  return `[${n}] ${authors}, "${titleFor(i)}," ${VENUE}, vol. 4, no. 1, pp. 12-24, ${ref.year}.`
}

// No quotation marks anywhere: the author segment has to be found by the full
// stop instead, and it runs straight into a title containing " and ".
function ieeeUnquoted(ref, n, i) {
  const authors = ref.surnames.map((s, k) => `${initial(k)} ${s}`).join(' and ')
  return `[${n}] ${authors}, ${titleFor(i)}. Cambridge: Academic Press, ${ref.year}.`
}

function mla(ref, i) {
  const [first, ...rest] = ref.surnames
  const head = `${first}, ${GIVEN[0]}`
  const tail = rest.map((s, k) => `${GIVEN[(k + 1) % GIVEN.length]} ${s}`)
  const authors =
    tail.length === 0
      ? head
      : tail.length === 1
        ? `${head}, and ${tail[0]}`
        : `${head}, ${tail.slice(0, -1).join(', ')}, and ${tail[tail.length - 1]}`
  return `${authors}. ${titleFor(i)}. Academic Press, ${ref.year}.`
}

function apa(ref, i) {
  const names = ref.surnames.map((s, k) => `${s}, ${initial(k)}`)
  const authors =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`
  return `${authors} (${ref.year}). ${titleFor(i)}. ${VENUE}, 28, 86-95.`
}

const STYLES = [
  { name: 'ieee-quoted', numbered: true, render: ieeeQuoted },
  { name: 'ieee-unquoted', numbered: true, render: ieeeUnquoted },
  { name: 'mla', numbered: false, render: mla },
  { name: 'apa-numbered', numbered: true, render: (ref, n, i) => `[${n}] ${apa(ref, i)}` }
]

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const results = []

for (const style of STYLES) {
  // One document per style, every reference in it — which also exercises entry
  // splitting across a list of 46 rather than a list of one.
  const entries = labelled.map((ref, i) =>
    style.numbered ? style.render(ref, i + 1, i) : style.render(ref, i)
  )
  const body = labelled
    .map((ref, i) =>
      style.numbered
        ? `Some assertion about the topic [${i + 1}].`
        : `Some assertion about the topic (${ref.surnames[0]} ${45 + i}).`
    )
    .join('\n')
  const document = `${body}\n\nReferences\n\n${entries.join('\n')}\n`

  const parsed = parseBibliography(document)

  for (const [i, ref] of labelled.entries()) {
    const sentence = style.numbered
      ? `Some assertion about the topic [${i + 1}].`
      : `Some assertion about the topic (${ref.surnames[0]} ${45 + i}).`
    const [resolved] = bibliographyReferences(sentence, document)

    const expected = ref.surnames.map(norm)
    const got = (resolved?.surnames ?? []).map(norm)
    const invented = got.filter((n) => !expected.includes(n))
    const missed = expected.filter((n) => !got.includes(n))

    results.push({
      style: style.name,
      label: ref.label,
      cite: `${ref.surnames.join(' & ')} ${ref.year}`,
      resolved: Boolean(resolved),
      entry: parsed[i]?.raw ?? null,
      invented,
      missed,
      yearOk: resolved ? resolved.year === ref.year : false,
      year: resolved?.year ?? null,
      checkable: resolved ? isCheckable(resolved) : false,
      accuses: resolved ? absenceIsInformative(resolved) : false
    })
  }
}

// ---------------------------------------------------------------------------

const byStyle = new Map()
for (const r of results) {
  if (!byStyle.has(r.style)) byStyle.set(r.style, [])
  byStyle.get(r.style).push(r)
}

console.log(`\n${labelled.length} labelled references × ${STYLES.length} citation styles\n`)
console.log('style           resolved  authors-exact  INVENTED  missed  year-ok  may-accuse')
console.log('-'.repeat(82))

for (const [style, rows] of byStyle) {
  const resolved = rows.filter((r) => r.resolved).length
  const exact = rows.filter((r) => r.resolved && !r.invented.length && !r.missed.length).length
  const invented = rows.filter((r) => r.invented.length > 0).length
  const missed = rows.filter((r) => r.missed.length > 0).length
  const yearOk = rows.filter((r) => r.yearOk).length
  const accuses = rows.filter((r) => r.accuses).length
  console.log(
    `${style.padEnd(15)} ${String(resolved).padStart(4)}/${rows.length}   ` +
      `${String(exact).padStart(6)}/${rows.length}   ` +
      `${String(invented).padStart(6)}   ${String(missed).padStart(5)}   ` +
      `${String(yearOk).padStart(4)}/${rows.length}   ${String(accuses).padStart(6)}/${rows.length}`
  )
}

const inventedRows = results.filter((r) => r.invented.length > 0)
const wrongYear = results.filter((r) => r.resolved && !r.yearOk)

// The one number that gates. An invented surname on an entry that may accuse is
// a real reference reported absent — the failure this whole check is built to
// avoid — so it is counted separately from an invented surname on an entry that
// can only ever corroborate.
const harmful = inventedRows.filter((r) => r.accuses)
const harmfulYear = wrongYear.filter((r) => r.accuses)

console.log(`\nINVENTED AUTHOR   ${inventedRows.length} total, ${harmful.length} on an entry that may accuse`)
console.log(`WRONG YEAR        ${wrongYear.length} total, ${harmfulYear.length} on an entry that may accuse`)
console.log(`AUTHORS MISSED    ${results.filter((r) => r.missed.length > 0).length} (safe: fewer names is easier to corroborate)`)
console.log(`UNRESOLVED        ${results.filter((r) => !r.resolved).length} (safe: unchecked, as before this existed)`)

for (const r of [...inventedRows, ...wrongYear].slice(0, 25)) {
  console.log(`\n  ${r.style} — ${r.cite}${r.accuses ? '  << MAY ACCUSE' : ''}`)
  if (r.invented.length) console.log(`    invented: ${r.invented.join(', ')}`)
  if (!r.yearOk) console.log(`    year: got ${r.year}, expected in "${r.cite}"`)
  console.log(`    entry: ${r.entry}`)
}

if (verbose) {
  for (const r of results) {
    console.log(
      `  ${r.resolved ? '·' : '✖'} ${r.style.padEnd(14)} ${r.cite.padEnd(34)} ` +
        `${r.checkable ? 'checkable' : 'skipped  '} ${r.accuses ? 'may-accuse' : 'corroborate-only'}`
    )
  }
}

console.log(
  `\n${harmful.length === 0 && harmfulYear.length === 0 ? 'PASS' : 'FAIL'} — an invented author or a wrong year on an entry that may accuse is a real citation called invented.\n`
)
