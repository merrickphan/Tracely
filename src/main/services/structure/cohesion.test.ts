import { strictEqual, ok } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { measureCohesion, type CohesionParagraph } from './cohesion.ts'

type Role = CohesionParagraph['role']

function paras(...specs: Array<[Role, string]>): CohesionParagraph[] {
  return specs.map(([role, text], i) => ({ index: i + 1, role, text }))
}

const SOLAR =
  'Solar capacity in Germany grew every year of the last decade, and the installed fleet now supplies a fifth of demand.'
const SOLAR_CONTINUED =
  'However, solar capacity of that size places demands on a grid built for a fleet of large thermal generators.'
const UNRELATED =
  'Medieval manuscript illumination relied on pigments carried by merchants across the Mediterranean.'

describe('measureCohesion — degenerate drafts', () => {
  it('scores a one-paragraph draft 100 with no boundaries', () => {
    const result = measureCohesion(paras(['thesis', SOLAR]))
    strictEqual(result.score, 100)
    strictEqual(result.boundaries, 0)
    strictEqual(result.findings.length, 0)
  })

  it('scores an empty draft 100 rather than 0', () => {
    strictEqual(measureCohesion([]).score, 100)
  })
})

describe('measureCohesion — boundaries', () => {
  it('gives full credit to a signposted continuation of the same subject', () => {
    const result = measureCohesion(paras(['claim', SOLAR], ['claim', SOLAR_CONTINUED]))
    strictEqual(result.boundaries, 1)
    ok(result.score >= 90, `expected near-full credit, got ${result.score}`)
    strictEqual(result.findings.length, 0)
  })

  it('flags an unsignposted change of subject as a topic jump', () => {
    const result = measureCohesion(paras(['claim', SOLAR], ['claim', UNRELATED]))
    ok(result.score < 25, `expected a low score, got ${result.score}`)
    strictEqual(result.findings.length, 1)
    strictEqual(result.findings[0].kind, 'topic-jump')
    strictEqual(result.findings[0].fromIndex, 1)
    strictEqual(result.findings[0].toIndex, 2)
  })

  it('scores a continuation that never signposts between the two', () => {
    const result = measureCohesion(
      paras(
        ['claim', SOLAR],
        ['claim', 'Grid operators in Germany now curtail solar output on days when demand falls short of supply.']
      )
    )
    ok(result.score > 0 && result.score < 100, `expected a mid score, got ${result.score}`)
    strictEqual(result.findings[0].kind, 'no-transition')
  })

  it('treats a claim followed by its evidence as bridged without a marker', () => {
    const result = measureCohesion(paras(['claim', SOLAR], ['evidence', UNRELATED]))
    strictEqual(result.findings.length, 0)
    ok(result.score >= 50)
  })

  it('averages over every boundary, not just the worst', () => {
    const good = measureCohesion(paras(['claim', SOLAR], ['claim', SOLAR_CONTINUED]))
    const bad = measureCohesion(paras(['claim', SOLAR_CONTINUED], ['claim', UNRELATED]))
    const both = measureCohesion(
      paras(['claim', SOLAR], ['claim', SOLAR_CONTINUED], ['claim', UNRELATED])
    )
    strictEqual(both.boundaries, 2)
    strictEqual(both.score, Math.round((good.score + bad.score) / 2))
  })
})

describe('measureCohesion — findings', () => {
  it('flags a counterargument the conclusion never answers', () => {
    const result = measureCohesion(
      paras(
        ['counterargument', `However, ${UNRELATED}`],
        ['conclusion', `In conclusion, ${UNRELATED}`]
      )
    )
    ok(result.findings.some((f) => f.kind === 'unanswered-counterargument'))
  })

  it('never puts the draft’s own words in a message', () => {
    const result = measureCohesion(paras(['claim', SOLAR], ['claim', UNRELATED]))
    for (const finding of result.findings) {
      ok(!finding.message.includes('Solar'))
      ok(!finding.message.includes('manuscript'))
    }
  })
})
