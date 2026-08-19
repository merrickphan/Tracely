import { strictEqual, deepStrictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTracerReply } from './tracerRewrite.ts'

const BLOCK = [
  '<<<REWRITE',
  'FIND: Fossil fuel companies are the root of all environmental degradation.',
  'REPLACE: Fossil fuel companies are a major driver of environmental degradation.',
  '>>>'
].join('\n')

describe('parseTracerReply', () => {
  it('returns the reply untouched when there is no block', () => {
    const out = parseTracerReply('That paragraph needs a warrant sentence.')
    strictEqual(out.rewrite, null)
    strictEqual(out.prose, 'That paragraph needs a warrant sentence.')
  })

  it('extracts a well-formed block and strips it from the prose', () => {
    const out = parseTracerReply(`Here is what I would change.\n\n${BLOCK}`)
    deepStrictEqual(out.rewrite, {
      find: 'Fossil fuel companies are the root of all environmental degradation.',
      replace: 'Fossil fuel companies are a major driver of environmental degradation.'
    })
    strictEqual(out.prose, 'Here is what I would change.')
  })

  it('refuses a rewrite that introduces a name the original never asserted', () => {
    // The 2026-08-16 production failure, in Tracer's clothing: the replacement
    // quietly swaps the subject to something the student did not claim.
    const out = parseTracerReply(
      [
        '<<<REWRITE',
        'FIND: Language models now score above the median human rater.',
        'REPLACE: Language models such as GPT-4 now score above the median human rater.',
        '>>>'
      ].join('\n')
    )
    strictEqual(out.rewrite, null)
  })

  it('leaves a rejected block visible in the prose', () => {
    const reply = [
      'Try this:',
      '<<<REWRITE',
      'FIND: ',
      'REPLACE: something',
      '>>>'
    ].join('\n')
    strictEqual(parseTracerReply(reply).rewrite, null)
    strictEqual(parseTracerReply(reply).prose.includes('<<<REWRITE'), true)
  })

  it('refuses a no-op rewrite', () => {
    const same = 'The policy failed.'
    const out = parseTracerReply(`<<<REWRITE\nFIND: ${same}\nREPLACE: ${same}\n>>>`)
    strictEqual(out.rewrite, null)
  })

  it('allows a narrowing that DROPS a named thing', () => {
    const out = parseTracerReply(
      [
        '<<<REWRITE',
        'FIND: The reform worked in Denmark, Sweden and Norway.',
        'REPLACE: The reform worked in three northern countries.',
        '>>>'
      ].join('\n')
    )
    strictEqual(out.rewrite?.replace, 'The reform worked in three northern countries.')
  })
})
