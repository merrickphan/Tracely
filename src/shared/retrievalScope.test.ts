import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { retrievalScopeFor } from './retrievalScope.ts'

describe('retrievalScopeFor — what the indexes cannot hold', () => {
  it('recognises a close reading', () => {
    strictEqual(
      retrievalScopeFor('The narrator withholds his own name until the third chapter.'),
      'primary-text'
    )
    strictEqual(retrievalScopeFor('In Act III the tone shifts entirely.'), 'primary-text')
    strictEqual(
      retrievalScopeFor('The novel refuses to resolve the question it opens with.'),
      'primary-text'
    )
  })

  it('recognises a claim about the text of a law', () => {
    strictEqual(retrievalScopeFor('Section 4 requires notice within thirty days.'), 'legal-text')
    strictEqual(
      retrievalScopeFor(
        'Education Code section 48907 protects student expression unless it is obscene.'
      ),
      'legal-text'
    )
  })

  it('recognises a named book making its own argument', () => {
    strictEqual(
      retrievalScopeFor(
        "Nancy Hoffman's Schooling in the Workplace argues that the American high school neglects vocational training."
      ),
      'primary-text'
    )
  })

  it('recognises one institution’s own records', () => {
    strictEqual(retrievalScopeFor('Our district cut twelve bus routes last year.'), 'local-fact')
    strictEqual(retrievalScopeFor("The council's own minutes record the vote."), 'local-fact')
    strictEqual(
      retrievalScopeFor('Lincoln High School moved its start time to 8:40.'),
      'local-fact'
    )
  })

  it('recognises the writer’s own observation', () => {
    strictEqual(retrievalScopeFor('I counted nine empty spaces at noon.'), 'personal')
    strictEqual(retrievalScopeFor('In my experience the opposite happens.'), 'personal')
  })

  it('recognises a claim about the future', () => {
    strictEqual(retrievalScopeFor('By 2040 the shortfall reaches nine billion.'), 'prediction')
    strictEqual(retrievalScopeFor('Costs are projected to double.'), 'prediction')
    strictEqual(retrievalScopeFor('Over the next decade the pattern holds.'), 'prediction')
    strictEqual(
      retrievalScopeFor('A debt crisis within the decade is unavoidable.'),
      'prediction'
    )
  })
})

/**
 * The three sentences the eval corpus caught this module excusing, each with
 * relevant sources a human had already counted. They are the reason two whole
 * rules were deleted, so they are pinned rather than described.
 */
describe('retrievalScopeFor — the corpus’s three false positives', () => {
  it('does not excuse a work’s publication history', () => {
    // 5 relevant sources. Printing history is bibliography, which is exactly
    // what scholarly indexes are made of — the veto, not the pattern, is what
    // saves this one.
    strictEqual(
      retrievalScopeFor(
        'The novel was published anonymously in 1818, and the revised 1831 edition carries a new preface.'
      ),
      null
    )
  })

  it('does not excuse a landmark case, which legal scholarship covers heavily', () => {
    // 7 and 10 relevant sources respectively.
    strictEqual(
      retrievalScopeFor(
        'In Tinker v. Des Moines (1969) the Supreme Court held that students do not shed their constitutional rights at the schoolhouse gate.'
      ),
      null
    )
    strictEqual(
      retrievalScopeFor(
        'Hazelwood v. Kuhlmeier narrowed that in 1988 by letting administrators exercise editorial control.'
      ),
      null
    )
  })
})

/**
 * The half that matters more. A false positive here EXCUSES a genuinely
 * unsupported claim — the writer is told to go and cite something that does not
 * exist, and the finding that would have caught them is withheld. A false
 * negative only leaves the old behaviour in place. Every sentence below is
 * ordinary academic prose the four indexes really do cover.
 */
describe('retrievalScopeFor — ordinary claims are left alone', () => {
  const inScope = [
    'Laptop note-takers scored lower on conceptual questions than longhand note-takers.',
    'Antibiotic resistance rose sharply across European hospitals after 2005.',
    'Later school start times are associated with improved adolescent sleep duration.',
    'Remote work reduced commuting emissions in metropolitan areas.',
    'The printing press accelerated the spread of vernacular literacy.',
    // "will" alone must not read as a prediction: it is essay scaffolding.
    'This essay will argue that the effect has been overstated.',
    'The argument will turn on how the threshold is defined.',
    // A general claim about cities is not one institution's records.
    'Cities that removed parking minimums saw denser infill development.',
    'Schools across the country report similar staffing shortages.',
    // "the author" is in the primary-text list; "authors" plural, as in the
    // authors of a study, must not be.
    'The authors found no significant difference between the two groups.',
    // A year is not a prediction when nothing points forward.
    'By 2010 the trend had already reversed.'
  ]

  for (const text of inScope) {
    it(`leaves alone: ${text.slice(0, 48)}…`, () => {
      strictEqual(retrievalScopeFor(text), null)
    })
  }
})

describe('retrievalScopeFor — precedence', () => {
  it('reports the more specific reason when a sentence matches twice', () => {
    // A statute quoted inside an anecdote is still a statute: that is the
    // reason that names the source the writer should cite.
    strictEqual(
      retrievalScopeFor('I noticed that Section 12 has never once been enforced.'),
      'legal-text'
    )
  })

  it('handles an empty string', () => {
    strictEqual(retrievalScopeFor(''), null)
  })
})
