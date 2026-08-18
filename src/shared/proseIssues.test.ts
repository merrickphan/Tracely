import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countProseIssues,
  findProseIssues,
  replacementRange,
  type ProseIssueKind
} from './proseIssues.ts'

const kinds = (text: string): ProseIssueKind[] => findProseIssues(text).map((i) => i.kind)
const first = (text: string) => findProseIssues(text)[0]

/** Nothing at all is flagged. The most important assertion in the file. */
function clean(text: string): void {
  const found = findProseIssues(text)
  deepStrictEqual(
    found.map((i) => `${i.kind}: ${i.text}`),
    [],
    `expected no issues in: ${text}`
  )
}

describe('repeated words', () => {
  it('catches a doubled word', () => {
    const issue = first('The the results were clear.')
    strictEqual(issue.kind, 'repeated-word')
    strictEqual(issue.suggestion, 'The')
  })

  it('leaves legitimate doubles alone', () => {
    // Correct past perfect and a correct (if ugly) relative clause. Flagging
    // these is the fastest way to teach a writer the checker does not know
    // English.
    clean('She had had enough of it.')
    clean('The claim that that study made was wrong.')
  })
})

describe('a / an', () => {
  it('catches "a" before a vowel sound', () => {
    const issue = first('This is a error in the data.')
    strictEqual(issue.kind, 'article-agreement')
    strictEqual(issue.suggestion, 'an')
  })

  it('catches "an" before a consonant sound', () => {
    strictEqual(first('She wrote an paper about it.').suggestion, 'a')
  })

  // The rule is about SOUND. A rule about spelling gets the most common words
  // in student writing wrong.
  it('leaves vowel letters with consonant sounds alone', () => {
    clean('She attended a university in a European city.')
    clean('It was a unique and useful result.')
    clean('There is a one in three chance.')
  })

  it('leaves silent-h words alone', () => {
    clean('They waited an hour for an honest answer.')
  })

  it('keeps the capitalisation of the article it replaces', () => {
    strictEqual(first('A error appeared.').suggestion, 'An')
  })
})

describe('its / it’s', () => {
  it("catches its', which is never correct", () => {
    strictEqual(first("The study lost its' funding.").kind, 'possessive-its')
  })

  it('catches a preposition followed by it’s', () => {
    const issue = first("The value of it's contents was unclear.")
    strictEqual(issue.kind, 'possessive-its')
    strictEqual(issue.suggestion, 'of its')
  })

  // Deciding between its and it's in general needs to know whether the next
  // word is a noun or a verb. Guessing that from a word list is how a checker
  // ends up correcting correct writing, so it is not attempted.
  it('does not guess at the general case', () => {
    clean("It's clear that the policy failed.")
    clean('The policy lost its funding.')
  })
})

describe('subject-verb agreement', () => {
  it('catches plural pronouns with singular verbs', () => {
    strictEqual(first('They was late to the meeting.').suggestion, 'They were')
    strictEqual(first('We has finished the report.').suggestion, 'We have')
  })

  it('catches singular pronouns with plural verbs', () => {
    // The suggestion keeps the writer's capitalisation.
    strictEqual(first('He were the first to arrive.').suggestion, 'He was')
    strictEqual(first('She do not agree.').suggestion, 'She does')
  })

  it('leaves the correct forms alone, including "I was"', () => {
    clean('I was late and they were early.')
    clean('He has finished and we have not.')
  })
})

describe('mechanics', () => {
  it('catches a space before punctuation', () => {
    strictEqual(first('The result was clear , and it held.').kind, 'spacing')
  })

  it('leaves ordinary punctuation alone', () => {
    clean('The result was clear, and it held.')
  })
})

describe('wordiness and filler', () => {
  it('offers the shorter equivalent', () => {
    const issue = first('The trial stopped due to the fact that funding ran out.')
    strictEqual(issue.kind, 'wordiness')
    strictEqual(issue.suggestion, 'because')
    strictEqual(issue.severity, 'style')
  })

  it('flags filler without pretending to know the fix', () => {
    const issue = first('The result was very clear.')
    strictEqual(issue.kind, 'filler')
    strictEqual(issue.suggestion, undefined)
  })

  it('marks these as style, never error', () => {
    for (const issue of findProseIssues('In order to finish, we very simply had to wait.')) {
      strictEqual(issue.severity, 'style', `${issue.kind} should be style`)
    }
  })
})

describe('passive voice', () => {
  it('flags only the agentive passive', () => {
    strictEqual(first('The report was written by the committee.').kind, 'passive-voice')
  })

  // The version every general passive check gets wrong. "The data were
  // collected in 2019" puts the data first because the data is the subject of
  // the paragraph, and there is no agent to promote.
  it('leaves an agentless passive alone', () => {
    clean('The data were collected in 2019.')
    clean('The samples are stored at room temperature.')
  })
})

describe('long sentences', () => {
  it('flags a runaway sentence', () => {
    const long = `This sentence ${'goes on and on '.repeat(12)}without stopping.`
    ok(kinds(long).includes('long-sentence'))
  })

  it('leaves ordinary academic prose alone', () => {
    clean(
      'The reforms raised turnout by nine points across the three districts studied, but they did not change which candidates were elected.'
    )
  })
})

describe('findProseIssues — shape', () => {
  it('returns issues in document order', () => {
    const issues = findProseIssues('They was late. The the report was very long.')
    const starts = issues.map((i) => i.start)
    deepStrictEqual(starts, [...starts].sort((a, b) => a - b))
  })

  it('offsets slice back to the matched text', () => {
    const text = 'This is a error in the data.'
    for (const issue of findProseIssues(text)) {
      strictEqual(text.slice(issue.start, issue.end), issue.text.slice(0, issue.end - issue.start))
    }
  })

  // The invariant applying a fix depends on. `[start, end)` is what gets
  // replaced; `text` is the wider phrase the message quotes and the anchor used
  // to re-find the issue after an edit. Replacing `text` instead of the prefix
  // turned "This is a error in the report" into "This is an in the report".
  it('keeps the replaced span a prefix of the matched text', () => {
    const samples = [
      'This is a error in the report.',
      'They was late to the the meeting.',
      'She wrote an paper about it.',
      'The result was clear , and it held.',
      "The study lost its' funding."
    ]
    for (const text of samples) {
      for (const issue of findProseIssues(text)) {
        const { start, end, target, anchor } = replacementRange(issue)
        strictEqual(text.slice(start, end), target, `${issue.kind} in "${text}"`)
        ok(anchor.startsWith(target), `${issue.kind}: target is not a prefix of the anchor`)
        ok(text.includes(anchor), `${issue.kind}: anchor is not in the source text`)
      }
    }
  })

  it('replaces only the article, not the phrase around it', () => {
    // The exact case that broke: the message quotes "a error", the underline
    // and the replacement cover "a".
    const text = 'This is a error in the report.'
    const issue = findProseIssues(text).find((i) => i.kind === 'article-agreement')!
    const { start, end } = replacementRange(issue)
    strictEqual(text.slice(start, end), 'a')
    strictEqual(
      text.slice(0, start) + issue.suggestion + text.slice(end),
      'This is an error in the report.'
    )
  })

  it('is empty for empty input', () => {
    deepStrictEqual(findProseIssues(''), [])
    deepStrictEqual(findProseIssues('   \n  '), [])
  })

  it('counts by severity', () => {
    const counts = countProseIssues(findProseIssues('They was very late.'))
    strictEqual(counts.errors, 1)
    strictEqual(counts.style, 1)
  })
})
