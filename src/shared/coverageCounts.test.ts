import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { searchableClaims } from './coverageCounts.ts'

describe('searchableClaims', () => {
  it('is the checked count when nothing is out of scope', () => {
    strictEqual(searchableClaims(7, 0, 3), 7)
  })

  it('holds out-of-scope claims out of the denominator', () => {
    strictEqual(searchableClaims(7, 2, 3), 5)
  })

  /**
   * Scope is decided from the claim's text, independently of what came back —
   * so a close reading of a novel that HAS criticism written about it is both
   * out of scope and sourced, and subtracting it anyway prints "3 of the 2 it
   * could search". The numerator counts sources actually found, so it is the
   * half that cannot be wrong.
   */
  it('never falls below the number of claims a source was found for', () => {
    strictEqual(searchableClaims(4, 3, 3), 3)
    strictEqual(searchableClaims(4, 4, 4), 4)
  })

  it('handles a draft where nothing has been checked', () => {
    strictEqual(searchableClaims(0, 0, 0), 0)
  })

  it('reaches zero when every checked claim is out of scope and none found sources', () => {
    // The branch that makes the report say "None of these claims are the kind
    // academic databases hold" instead of a ratio over nothing.
    strictEqual(searchableClaims(3, 3, 0), 0)
  })
})
