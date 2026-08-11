import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeFit, structureFit } from './structureFit.ts'

/** n paragraphs of `chars` characters each. */
function paragraphs(n: number, chars: number): string[] {
  return Array.from({ length: n }, () => 'x'.repeat(chars))
}

function fitOf(list: string[]): string {
  return structureFit({ paragraphs: list, textLength: list.join('\n').length })
}

describe('structureFit', () => {
  it('accepts an ordinary essay', () => {
    strictEqual(fitOf(paragraphs(6, 400)), 'ok')
  })

  it('reports one long paragraph as an extraction failure, not a short draft', () => {
    // The ValuePattern fallback and some Chromium-hosted editors return the
    // whole document with no newlines at all.
    strictEqual(fitOf(paragraphs(1, 3000)), 'unsplit')
  })

  it('reports a genuinely short single paragraph as too short', () => {
    // Same paragraph count, different cause — a real one-paragraph answer is
    // not a broken read, and the debug log should not say it is.
    strictEqual(fitOf(paragraphs(1, 200)), 'too-short')
  })

  it('reports a two-paragraph draft as too short', () => {
    // scoreDraft's body is roles.slice(1, -1), which is empty here, so four of
    // six components are structurally zero.
    strictEqual(fitOf(paragraphs(2, 400)), 'too-short')
  })

  it('accepts exactly three paragraphs', () => {
    strictEqual(fitOf(paragraphs(3, 400)), 'ok')
  })

  it('reports many short runs as line-wrapped', () => {
    strictEqual(fitOf(paragraphs(30, 60)), 'line-wrapped')
  })

  it('does not call a short note line-wrapped', () => {
    // Four short paragraphs is a plausible note. The paragraph-count floor is
    // what separates that from a rendering artefact.
    strictEqual(fitOf(paragraphs(4, 60)), 'ok')
  })

  it('does not call a long-paragraph essay line-wrapped however many there are', () => {
    strictEqual(fitOf(paragraphs(30, 400)), 'ok')
  })

  it('handles an empty document', () => {
    strictEqual(structureFit({ paragraphs: [], textLength: 0 }), 'too-short')
  })

  it('measures the mean on trimmed text, so indentation cannot mask a wrap', () => {
    const indented = Array.from({ length: 20 }, () => `${' '.repeat(200)}short line here`)
    strictEqual(fitOf(indented), 'line-wrapped')
  })
})

describe('describeFit', () => {
  it('gives a reason for every outcome', () => {
    for (const fit of ['ok', 'too-short', 'unsplit', 'line-wrapped'] as const) {
      strictEqual(typeof describeFit(fit), 'string')
    }
  })
})
