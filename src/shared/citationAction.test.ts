import { describe, it } from 'node:test'
import { strictEqual } from 'node:assert/strict'
import { insertsCitation } from './citationAction.ts'

/**
 * The four action strings `popoverCopyFor` can produce. Reword one there and it
 * must be reworded here — this test is what makes that a visible failure rather
 * than a silently disabled Insert button.
 */
describe('insertsCitation', () => {
  it('offers to insert only where the card is asking for a citation', () => {
    strictEqual(insertsCitation('Add citation'), true)
    strictEqual(insertsCitation('Find a source'), true)
  })

  // Fires on a claim the writer ALREADY cited. Offering to insert one
  // contradicts the sentence directly above the button.
  it('does not offer to insert when the card says to compare', () => {
    strictEqual(insertsCitation('Compare sources'), false)
  })

  // The card has just said these sources do not confirm the claim.
  it('does not offer to insert when the card says to review', () => {
    strictEqual(insertsCitation('Review the sources'), false)
  })

  it('defaults to not inserting for anything it does not recognise', () => {
    strictEqual(insertsCitation(''), false)
    strictEqual(insertsCitation('add citation'), false)
  })
})
