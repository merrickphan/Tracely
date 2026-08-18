/**
 * Grammar, mechanics and wordiness — the checks that are honest without a parser.
 *
 * Everything else in this app asks whether a sentence is TRUE. This asks
 * whether it is written correctly, which is a different question with a
 * different failure mode: a credibility flag that is wrong makes the tool look
 * cautious, and a grammar flag that is wrong makes it look illiterate. Writers
 * forgive the first and switch the second off. So every rule here is bounded to
 * what can be decided from the surface of the text, and anything needing a
 * syntax tree is deliberately absent — there is no comma-splice rule, no
 * fragment rule, and no its/it's rule beyond the two shapes that are always
 * wrong whatever the sentence means.
 *
 * A leaf with tests, and the tests carry the NEGATIVE cases as seriously as the
 * positives: "a university", "an hour", "had had", "the data were collected"
 * are all correct English that a careless version of these rules flags.
 *
 * Severity is not decoration. `error` is a mechanical mistake with one right
 * answer. `style` is a suggestion the writer is free to refuse — wordiness,
 * filler, agentive passive — and it must never be drawn in the same weight,
 * because a tool that flags "very" as urgently as "they was" has taught the
 * user to ignore both.
 */

export type ProseIssueKind =
  | 'repeated-word'
  | 'article-agreement'
  | 'possessive-its'
  | 'subject-verb'
  | 'spacing'
  | 'wordiness'
  | 'filler'
  | 'passive-voice'
  | 'long-sentence'

export type ProseSeverity = 'error' | 'style'

export interface ProseIssue {
  /** Offsets into the text this was found in, so a caller can underline it. */
  start: number
  end: number
  kind: ProseIssueKind
  severity: ProseSeverity
  /** What is wrong, in one line, addressed to the writer. */
  message: string
  /** The replacement, when there is exactly one. Absent when the fix is a
   *  judgement — "very" has no single right removal. */
  suggestion?: string
  /** The matched text, so a caller can show it without re-slicing. */
  text: string
}

/** Words that legitimately double. "Had had" is correct past perfect; "that
 *  that" is correct though ugly. Flagging them is the fastest way to teach a
 *  writer that the checker does not know English. */
const LEGITIMATE_DOUBLES = new Set(['had', 'that', 'is'])

/**
 * Words beginning with a vowel LETTER but a consonant SOUND, which correctly
 * take "a". The article rule is about sound, and a rule about spelling gets
 * "a university" wrong — one of the most common words in student writing.
 */
const CONSONANT_SOUND_VOWELS =
  /^(?:un(?:i(?:versit|que|form|on|t|fy|lateral)|animous)|eu|ewe|once|one|ubiquit|usual|usab|user|utili|utopi)/i

/**
 * Words beginning with a silent H, which correctly take "an". Short and closed
 * on purpose: these are the only common ones, and guessing wider would flag
 * "an hotel" as correct in a dialect most writers are not using.
 */
const SILENT_H = /^(?:hour|honest|honou?r|heir|homage)/i

/** Wordy phrases with one shorter equivalent that means the same thing. Style,
 *  never error: "in order to" is not wrong, it is just longer than "to". */
const WORDY: Array<[RegExp, string]> = [
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\bin the event that\b/gi, 'if'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat the present time\b/gi, 'now'],
  [/\bin order to\b/gi, 'to'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\bhave the ability to\b/gi, 'can'],
  [/\ba large number of\b/gi, 'many'],
  [/\ba small number of\b/gi, 'a few'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bit is important to note that\b/gi, ''],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bin the process of\b/gi, ''],
  [/\bwith regard to\b/gi, 'about'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after']
]

/**
 * Intensifiers and hedges that weaken a sentence without adding to it.
 *
 * No suggestion is offered, because there isn't one — the fix is deletion, and
 * whether a given "very" is doing work is the writer's call. Flagged so the
 * pattern is visible across a draft, which is where it actually shows.
 */
const FILLER =
  /\b(?:very|really|quite|extremely|actually|basically|literally|just|simply|totally|definitely|certainly|clearly|obviously)\b/gi

/**
 * The AGENTIVE passive only — "was written by the committee".
 *
 * Passive voice is not an error and is often the right choice: "the data were
 * collected in 2019" puts the data first because the data is the subject of the
 * paragraph. What is reliably reducible is the version that names its agent,
 * because the active sentence is sitting right there in the "by" phrase. Every
 * general passive-voice check is the reason people turn grammar tools off.
 */
const AGENTIVE_PASSIVE =
  /\b(?:is|are|was|were|been|being|be)\s+(?:\w+ed|written|shown|given|taken|made|seen|known|held|found|built|sent|told|kept|left|brought)\s+by\b/gi

/** Past this many words a sentence is hard to hold, whatever it is doing. Set
 *  well above ordinary academic prose so it flags the runaway, not the long. */
const LONG_SENTENCE_WORDS = 45

function push(issues: ProseIssue[], issue: ProseIssue): void {
  issues.push(issue)
}

/** Every mechanical and stylistic issue in `text`, in document order. */
export function findProseIssues(text: string): ProseIssue[] {
  const issues: ProseIssue[] = []
  if (!text.trim()) return issues

  // -- repeated word ------------------------------------------------------
  for (const m of text.matchAll(/\b(\w+)(\s+)\1\b/gi)) {
    if (LEGITIMATE_DOUBLES.has(m[1].toLowerCase())) continue
    push(issues, {
      start: m.index,
      end: m.index + m[0].length,
      kind: 'repeated-word',
      severity: 'error',
      message: `"${m[1]}" is repeated.`,
      suggestion: m[1],
      text: m[0]
    })
  }

  // -- a / an -------------------------------------------------------------
  // Case-insensitive: a sentence-initial "A error" is the commonest place this
  // mistake appears, and a case-sensitive pattern never saw it.
  for (const m of text.matchAll(/\b(a|an)\s+([A-Za-z]+)/gi)) {
    const [full, article, word] = m
    const startsVowel = /^[aeiou]/i.test(word)
    const wrongA = article.toLowerCase() === 'a' && startsVowel && !CONSONANT_SOUND_VOWELS.test(word)
    const wrongAn = article.toLowerCase() === 'an' && !startsVowel && !SILENT_H.test(word)
    if (!wrongA && !wrongAn) continue
    const fixed = wrongA ? 'an' : 'a'
    push(issues, {
      start: m.index,
      end: m.index + article.length,
      kind: 'article-agreement',
      severity: 'error',
      message: `"${article} ${word}" — use "${fixed}" before this word.`,
      // Capitalisation carried over, so a sentence-initial "A" is not replaced
      // by a lowercase "an".
      suggestion: article[0] === article[0].toUpperCase() ? fixed[0].toUpperCase() + fixed.slice(1) : fixed,
      text: full
    })
  }

  // -- its / it's ---------------------------------------------------------
  // Only the two shapes that are wrong whatever the sentence means. Deciding
  // between "its" and "it's" in general needs to know whether the next word is
  // a noun or a verb, and guessing that from a word list is how a checker ends
  // up correcting correct writing.
  for (const m of text.matchAll(/\bits'/g)) {
    push(issues, {
      start: m.index,
      end: m.index + m[0].length,
      kind: 'possessive-its',
      severity: 'error',
      message: '"its\'" is never correct — "its" is already possessive.',
      suggestion: 'its',
      text: m[0]
    })
  }
  for (const m of text.matchAll(/\b(of|in|on|at|to|for|with|from|by)\s+(it's)\b/gi)) {
    push(issues, {
      start: m.index,
      end: m.index + m[0].length,
      kind: 'possessive-its',
      severity: 'error',
      message: `"${m[1]} it's" should be "${m[1]} its" — a preposition takes the possessive.`,
      suggestion: `${m[1]} its`,
      text: m[0]
    })
  }

  // -- subject-verb agreement --------------------------------------------
  // Pronoun subjects only. They are unambiguous — "they was" is wrong in every
  // context — where a noun subject needs to know whether it is plural, which
  // is exactly what cannot be read off the surface.
  // Both patterns are case-insensitive, and the SUGGESTION keeps the writer's
  // capitalisation — a sentence beginning "They was" must not come back
  // corrected to "they were".
  const agreement = (
    pattern: RegExp,
    fixes: Record<string, string>,
    skip?: (subject: string, verb: string) => boolean
  ): void => {
    for (const m of text.matchAll(pattern)) {
      const [full, subject, verb] = m
      if (skip?.(subject.toLowerCase(), verb.toLowerCase())) continue
      const fixed = fixes[verb.toLowerCase()]
      push(issues, {
        start: m.index,
        end: m.index + full.length,
        kind: 'subject-verb',
        severity: 'error',
        message: `"${subject} ${verb}" — use "${subject} ${fixed}".`,
        suggestion: `${subject} ${fixed}`,
        text: full
      })
    }
  }

  agreement(
    /\b(I|we|they|you)\s+(was|has|does|is)\b/gi,
    { was: 'were', has: 'have', does: 'do', is: 'are' },
    // "I was" is correct. "I is" is wrong but rare enough in real writing that
    // refusing both is safer than ever correcting "I was" to "I were".
    (subject, verb) => subject === 'i' && (verb === 'was' || verb === 'is')
  )
  agreement(/\b(he|she|it)\s+(were|have|do)\b/gi, { were: 'was', have: 'has', do: 'does' })

  // -- spacing / mechanics ------------------------------------------------
  for (const m of text.matchAll(/\s+([,.;:!?])/g)) {
    push(issues, {
      start: m.index,
      end: m.index + m[0].length,
      kind: 'spacing',
      severity: 'error',
      message: `Remove the space before "${m[1]}".`,
      suggestion: m[1],
      text: m[0]
    })
  }

  // -- wordiness ----------------------------------------------------------
  for (const [pattern, replacement] of WORDY) {
    for (const m of text.matchAll(pattern)) {
      push(issues, {
        start: m.index,
        end: m.index + m[0].length,
        kind: 'wordiness',
        severity: 'style',
        message: replacement
          ? `"${m[0]}" can be "${replacement}".`
          : `"${m[0]}" can usually be cut.`,
        ...(replacement ? { suggestion: replacement } : {}),
        text: m[0]
      })
    }
  }

  // -- filler -------------------------------------------------------------
  for (const m of text.matchAll(FILLER)) {
    push(issues, {
      start: m.index,
      end: m.index + m[0].length,
      kind: 'filler',
      severity: 'style',
      message: `"${m[0]}" rarely adds anything — check whether the sentence is stronger without it.`,
      text: m[0]
    })
  }

  // -- agentive passive ---------------------------------------------------
  for (const m of text.matchAll(AGENTIVE_PASSIVE)) {
    push(issues, {
      start: m.index,
      end: m.index + m[0].length,
      kind: 'passive-voice',
      severity: 'style',
      message: 'Passive with a named agent — the active version is usually shorter.',
      text: m[0]
    })
  }

  // -- long sentences -----------------------------------------------------
  let cursor = 0
  for (const sentence of text.split(/(?<=[.!?]["'’”)\]]*)\s+/)) {
    const start = text.indexOf(sentence, cursor)
    if (start === -1) continue
    cursor = start + sentence.length
    const words = sentence.trim().split(/\s+/).filter(Boolean).length
    if (words <= LONG_SENTENCE_WORDS) continue
    push(issues, {
      start,
      end: start + sentence.length,
      kind: 'long-sentence',
      severity: 'style',
      message: `${words} words in one sentence — consider splitting it.`,
      text: sentence
    })
  }

  return issues.sort((a, b) => a.start - b.start || a.end - b.end)
}

/**
 * Exactly which characters `suggestion` replaces.
 *
 * `[start, end)` and `text` are NOT the same span, deliberately, and getting
 * that wrong silently eats words. The article rule underlines only the article
 * — `end - start` is one or two characters — while carrying "a error" as its
 * `text`, because the message has to quote the phrase to be worth reading. A
 * caller that replaced `text` with `suggestion` there would turn "This is a
 * error in the report" into "This is an in the report", which is what happened
 * the first time this was wired up.
 *
 * The invariant this encodes, and which `proseIssues.test.ts` pins: the
 * replaced span is always a PREFIX of `text`. `text` is the anchor used to
 * re-find the issue when the document has shifted underneath it; the prefix is
 * what actually gets swapped.
 */
export function replacementRange(issue: ProseIssue): {
  start: number
  end: number
  /** The characters `suggestion` stands in for. */
  target: string
  /** The wider match, for re-anchoring after an edit. */
  anchor: string
  /** Where `target` begins inside `anchor`. Always 0 today; returned rather
   *  than assumed so a future rule may flag a word mid-phrase. */
  offsetInAnchor: number
} {
  const target = issue.text.slice(0, issue.end - issue.start)
  return { start: issue.start, end: issue.end, target, anchor: issue.text, offsetInAnchor: 0 }
}

/** How many of each severity, for a summary line. */
export function countProseIssues(issues: ProseIssue[]): { errors: number; style: number } {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    style: issues.filter((i) => i.severity === 'style').length
  }
}
