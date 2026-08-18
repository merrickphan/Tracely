import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { greetingFor } from './greeting.ts'

describe('greetingFor', () => {
  it('changes at noon and at six', () => {
    strictEqual(greetingFor(11), 'Good morning')
    strictEqual(greetingFor(12), 'Good afternoon')
    strictEqual(greetingFor(17), 'Good afternoon')
    strictEqual(greetingFor(18), 'Good evening')
  })

  it('covers the whole day', () => {
    for (let h = 0; h < 24; h++) {
      strictEqual(typeof greetingFor(h), 'string')
      strictEqual(greetingFor(h).startsWith('Good'), true, `hour ${h}`)
    }
  })

  it('falls back rather than greeting nobody', () => {
    strictEqual(greetingFor(NaN), 'Hello')
  })
})
