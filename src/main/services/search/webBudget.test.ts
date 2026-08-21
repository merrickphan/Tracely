import { describe, it, beforeEach } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import {
  MAX_WEB_SEARCHES_PER_ANALYSIS,
  MAX_WEB_SEARCHES_PER_HOUR,
  __resetWebBudget,
  takeWebSearch,
  webSearchesSpent,
  webSearchesThisHour
} from './webBudget.ts'

const T0 = 1_800_000_000_000
const HOUR = 1000 * 60 * 60

beforeEach(() => __resetWebBudget())

/**
 * This bounds the only paid provider in retrieval, and the only one whose cost
 * our own usage log cannot see — OpenAI bills the web-search tool separately
 * from tokens, so `[usage] find-sources … cost=$…` reports the smaller half.
 * Every test here is a ceiling holding.
 */
describe('takeWebSearch — per analysis', () => {
  it('allows exactly the cap, then refuses', () => {
    for (let i = 0; i < MAX_WEB_SEARCHES_PER_ANALYSIS; i++) {
      strictEqual(takeWebSearch('a1', T0).allowed, true, `call ${i + 1}`)
    }
    const over = takeWebSearch('a1', T0)
    strictEqual(over.allowed, false)
    strictEqual(over.reason, 'per-analysis-cap')
  })

  it('gives each analysis its own budget', () => {
    for (let i = 0; i < MAX_WEB_SEARCHES_PER_ANALYSIS; i++) takeWebSearch('a1', T0)
    strictEqual(takeWebSearch('a2', T0).allowed, true)
    strictEqual(webSearchesSpent('a1'), MAX_WEB_SEARCHES_PER_ANALYSIS)
    strictEqual(webSearchesSpent('a2'), 1)
  })

  // Taken BEFORE spending, not recorded after: the sweep runs three claims at
  // once, so a decision made on completion cannot bound calls in flight.
  it('counts a refused call as not spent', () => {
    for (let i = 0; i < MAX_WEB_SEARCHES_PER_ANALYSIS + 3; i++) takeWebSearch('a1', T0)
    strictEqual(webSearchesSpent('a1'), MAX_WEB_SEARCHES_PER_ANALYSIS)
  })
})

describe('takeWebSearch — the hourly backstop', () => {
  /**
   * The per-analysis cap assumes analyses are discrete, and nothing enforces
   * that: Screen Watch mints a fresh claim id per detection and the editor now
   * detects on a debounce. A loop making a NEW analysis every time would honour
   * the per-analysis cap perfectly and still spend without limit.
   */
  it('holds when every call arrives under a different analysis id', () => {
    let allowed = 0
    for (let i = 0; i < MAX_WEB_SEARCHES_PER_HOUR + 10; i++) {
      if (takeWebSearch(`analysis-${i}`, T0).allowed) allowed++
    }
    strictEqual(allowed, MAX_WEB_SEARCHES_PER_HOUR)
    strictEqual(takeWebSearch('another', T0).reason, 'hourly-cap')
  })

  it('is a rolling window, not a fixed bucket', () => {
    for (let i = 0; i < MAX_WEB_SEARCHES_PER_HOUR; i++) takeWebSearch(`a-${i}`, T0)
    strictEqual(takeWebSearch('later', T0 + HOUR - 1).allowed, false)
    strictEqual(takeWebSearch('later', T0 + HOUR + 1).allowed, true)
  })

  it('reports what the window currently holds', () => {
    takeWebSearch('a1', T0)
    takeWebSearch('a1', T0 + 1000)
    strictEqual(webSearchesThisHour(T0 + 2000), 2)
    strictEqual(webSearchesThisHour(T0 + HOUR + 2000), 0)
  })
})

describe('takeWebSearch — no analysis id', () => {
  /**
   * Screen Watch passes none. Keying on the fresh uuid it happens to carry
   * would hand every passive re-read a brand new budget, which is the one
   * surface that reads text forever without being asked.
   */
  it('shares one bucket, bounded by the hour rather than per analysis', () => {
    for (let i = 0; i < MAX_WEB_SEARCHES_PER_ANALYSIS + 2; i++) {
      strictEqual(takeWebSearch(null, T0).allowed, true, `call ${i + 1}`)
    }
    // ...but the hourly ceiling still catches it.
    let allowed = MAX_WEB_SEARCHES_PER_ANALYSIS + 2
    while (takeWebSearch(null, T0).allowed) allowed++
    strictEqual(allowed, MAX_WEB_SEARCHES_PER_HOUR)
  })

  it('does not share that bucket with a real analysis', () => {
    for (let i = 0; i < MAX_WEB_SEARCHES_PER_ANALYSIS; i++) takeWebSearch(null, T0)
    strictEqual(takeWebSearch('a1', T0).allowed, true)
  })
})
