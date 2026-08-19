import type { ParagraphRole } from '@shared/types'

/**
 * The parts of "is this thinking any good?" that can be decided from the text.
 *
 * The rubric in `scoreDraft.ts` asks what each paragraph IS — thesis, evidence,
 * counterargument. It never asks whether the paragraph does its job well, so a
 * draft that quotes a source and moves on scores the same as one that explains
 * what the quotation showed, provided a model labelled both 'evidence'. That is
 * the gap this module closes: the CLAIM → EVIDENCE → REASONING → SIGNIFICANCE
 * chain, checked for the link that is missing rather than for the boxes that
 * are ticked.
 *
 * **Most of that chain is not decidable here, and this module does not pretend
 * otherwise.** Whether evidence actually proves the claim it is attached to,
 * whether a counterargument is the strongest one available, whether an analysis
 * explains a mechanism or merely restates — those need a reader, and they live
 * in the relay prompts (`CRITIQUE_SYSTEM_PROMPT` and `STRUCTURE_SYSTEM_PROMPT`
 * in `../Tracely-relay/lib/prompts.ts`). What is here is the subset a rule can
 * be right about, and the bar for admitting a rule is the one `proseIssues.ts`
 * sets: a reasoning flag that is wrong teaches the writer to distrust every
 * other flag, and the cheapest way to be wrong is to guess at intent.
 *
 * So every detector below is anchored — to the END of a paragraph, to the START
 * of a paragraph, to a closed word list — rather than matched anywhere in the
 * draft, and each one carries its negative cases in
 * `reasoningIssues.test.ts`.
 *
 * A leaf: type-only imports, no relative value imports, so the test runner can
 * load it. Message text is NOT built here — `weaknesses.ts` owns every string a
 * student reads, for the reason in its header.
 */

export type ReasoningIssueKind =
  /**
   * Evidence introduced and never analysed: the paragraph's last sentence IS
   * the quotation or the citation.
   *
   * The one detector here with a SCORE effect (it vetoes `hasWarrant` — see
   * analyzeStructure.ts), because it is the direct mechanical reading of the
   * thing `warrant` already claims to measure. A paragraph that stops on its
   * source has left the reasoning in the writer's head.
   */
  | 'dropped-evidence'
  /** Absolute language the argument never earns — "always", "everyone", "proves". */
  | 'overreaching-claim'
  /** An adjective standing in for the reasoning — "obviously", "massive". */
  | 'unsupported-emphasis'
  /** A paragraph opening on "This shows…" with its antecedent in another paragraph. */
  | 'unclear-reference'
  /** A conclusion that restates the thesis rather than synthesising. Also scored. */
  | 'restated-conclusion'
  /** Two adjacent sentences making the same point in different words. */
  | 'undeveloped-repetition'
  /** "Since the beginning of time", "Webster's dictionary defines". */
  | 'generic-opening'

export interface ReasoningParagraph {
  /** 1-based, matching ParagraphOutline.index. */
  index: number
  text: string
  role: ParagraphRole
}

export interface ReasoningInput {
  paragraphs: ReasoningParagraph[]
  /**
   * 0-based position of the paragraph carrying the thesis, or null when none
   * was found. Only `restated-conclusion` uses it, and it is silent without it:
   * "this conclusion repeats the thesis" is unsayable when nothing identified a
   * thesis to repeat.
   */
  thesisIndex: number | null
  /** Paragraph 1 is the essay's title — see ScoreSignals.titleParagraph. */
  titleParagraph?: boolean
}

export interface ReasoningFinding {
  kind: ReasoningIssueKind
  /** 1-based, or null for a whole-draft finding. */
  paragraphIndex: number | null
  /**
   * The words that triggered it, trimmed to something quotable.
   *
   * Every other finding in this engine names a paragraph and stops, which is
   * enough when the claim is "there is no counterargument". It is not enough
   * for "this sentence overreaches": a writer sent to a 90-word paragraph to
   * find one adverb will not find it, and a flag nobody can act on is noise
   * however true it is.
   */
  quote: string
}

/**
 * Function words, dropped before any overlap is measured.
 *
 * Two sentences of English share these whatever they mean, so leaving them in
 * makes every pair of sentences look ~40% identical and every threshold
 * arbitrary. The list is deliberately plain — no stemming, no lemmatiser —
 * because both detectors that use it are gated at high thresholds where a
 * missed inflection costs a finding rather than causing a false one.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can', 'could', 'did',
  'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'hers', 'him', 'his', 'how', 'i',
  'if', 'in', 'into', 'is', 'it', 'its', 'may', 'might', 'more', 'most', 'must', 'my', 'no', 'not',
  'of', 'on', 'or', 'our', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'up', 'was', 'we', 'were',
  'what', 'when', 'which', 'while', 'who', 'will', 'with', 'would', 'you', 'your'
])

/**
 * Absolutes, and the shapes they have to appear in.
 *
 * Bare "all" and "every" are not here and must not be added: "all of the
 * evidence", "every year" and "in every case she filmed" are ordinary English,
 * and a rule that flags them fires on most paragraphs of most essays. What is
 * flagged is the quantifier that makes a claim unfalsifiable — a universal over
 * PEOPLE, or a verb asserting proof.
 */
const ABSOLUTES: RegExp[] = [
  /\balways\b/i,
  /\bnever\b/i,
  /\beveryone\b/i,
  /\beverybody\b/i,
  /\bnobody\b/i,
  /\bno one\b/i,
  // Universals over PEOPLE only. "Every country", "all cultures" and "every
  // society" were here and came out again: "she visited every country on the
  // itinerary" is a fact about a tour, and a rule that reads it as an
  // unfalsifiable claim fires on ordinary narration in most history essays.
  /\ball (?:people|humans|students|women|men|americans)\b/i,
  /\bevery (?:person|human|student|woman|man|american)\b/i,
  /\bcompletely\b/i,
  /\bentirely\b/i,
  /\btotally\b/i,
  /\buniversally\b/i,
  /\bwithout exception\b/i,
  /\bproves\b/i,
  /\bproven\b/i
]

/**
 * Hedges that make an absolute defensible, checked in the words immediately
 * before the match.
 *
 * "Almost always", "not everyone", "hardly ever", "rarely proves" are the
 * writer already doing the thing this finding would ask them to do, and
 * flagging them is how a rubric teaches a student that qualifying was
 * pointless.
 */
const HEDGE_BEFORE =
  /\b(?:almost|nearly|not|never|hardly|rarely|seldom|virtually|practically|scarcely)\s+(?:\w+\s+){0,1}$/i

/**
 * Adjectives and adverbs that assert a judgement instead of arguing for one.
 *
 * The rubric's phrasing is exact and worth keeping: these are flagged when they
 * SUBSTITUTE for reasoning. "Obviously" is the writer telling the reader the
 * inference is already made; "devastating" is the conclusion of an argument
 * used as its premise. None of them are wrong words — they are words that have
 * to be earned by the sentences around them, and the finding says so rather
 * than proposing a replacement.
 */
const EMPHASIS: RegExp[] = [
  /\bobviously\b/i,
  /\bclearly\b/i,
  /\bundeniably\b/i,
  /\bundoubtedly\b/i,
  /\bof course\b/i,
  /\bwithout (?:a )?doubt\b/i,
  /\bit goes without saying\b/i,
  /\bmassive\b/i,
  /\bincredible\b/i,
  /\bamazing\b/i,
  /\btremendous\b/i,
  /\bdevastating\b/i,
  /\bhorrific\b/i,
  /\bterrible\b/i
]

/** Openings that say nothing about this essay and could open any other. */
const GENERIC_OPENINGS: RegExp[] = [
  /^since the (?:beginning|dawn) of time\b/i,
  /^since the (?:beginning|dawn) of (?:human )?(?:history|civili[sz]ation)\b/i,
  /^throughout (?:all of )?(?:human )?history\b/i,
  /^ever since (?:the beginning|humans|people|man)\b/i,
  /^in today'?s (?:society|world|day and age|modern world)\b/i,
  /^in (?:modern|present-day) society\b/i,
  /^(?:the |merriam-?)?(?:webster'?s )?dictionary defines\b/i,
  /^merriam-?webster defines\b/i
]

/**
 * A demonstrative opening a paragraph with its antecedent in the previous one.
 *
 * Restricted to the paragraph's FIRST sentence on purpose. Mid-paragraph, "This
 * shows" almost always points at the sentence just before it and the reader has
 * no trouble; across a paragraph break the referent is a whole paragraph, and
 * "this" is being asked to carry an argument the writer never stated. The
 * pronoun must be followed by a verb rather than a noun — "This pattern shows"
 * names what it means and is not the error.
 */
const DANGLING_OPENER =
  /^(This|These|That|Those)\s+(shows?|proves?|means?|demonstrates?|suggests?|indicates?|reveals?|illustrates?|highlights?|explains?|creates?|caused?|led|results?|supports?|confirms?)\b/

/**
 * A citation at the very end of a sentence, in the forms real drafts use.
 *
 * Anchored at the end because that is the whole question this detector asks:
 * did the paragraph STOP here?
 *
 * Each alternative has to look like a REFERENCE, not merely like a bracket.
 * `\([^)]*\)` was the first version and it read "(an itinerary few would
 * attempt)" as a citation, which turns every parenthetical aside at the end of
 * a paragraph into an accusation that the writer dropped a source. So: an
 * author-year with a real four-digit year, an MLA author-page whose page is a
 * number, a page or ibid marker, or a bracketed numeric reference.
 */
const TRAILING_CITATION =
  /(?:\([^)]{0,80}\b(?:1[5-9]|20)\d{2}[a-z]?\s*\)|\(\s*[A-Z][^),]{0,40}\s+\d{1,4}\s*\)|\(\s*(?:pp?\.|ibid|op\. ?cit)[^)]{0,40}\)|\[\d{1,3}(?:[-–,]\s?\d{1,3})*\])\s*[.?!]?\s*$/

/** A quotation of real length — four words or more between quote marks. */
const SUBSTANTIAL_QUOTE = /["“”'‘’]\s*(?:\S+\s+){3,}\S+\s*["“”'‘’]/

function contentWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []
  return words.filter((word) => word.length > 2 && !STOPWORDS.has(word))
}

/**
 * The fraction of `a`'s content words that also appear in `b`.
 *
 * Deliberately asymmetric. "Does the conclusion say anything the thesis did
 * not?" is a question about the conclusion, and a symmetric measure would let a
 * long thesis paragraph hide a conclusion that is entirely contained in it.
 */
function overlapInto(a: string[], b: string[]): number {
  if (a.length === 0) return 0
  const other = new Set(b)
  const shared = new Set(a.filter((word) => other.has(word)))
  return shared.size / new Set(a).size
}

/**
 * Sentence splitting, duplicated from `roles.ts` rather than imported.
 *
 * Both modules are unit-tested leaves, and `npm test` runs them through Node's
 * type stripping, whose ESM resolver rejects the extensionless relative imports
 * this codebase uses everywhere. Three lines of duplication is the price of the
 * two modules that decide the score being testable at all — see the note in
 * CLAUDE.md.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])["'”’)\]]*\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/** Text with every quoted run removed, so a source's words are not read as the writer's. */
function withoutQuotations(text: string): string {
  return text.replace(/["“][^"”]{0,400}["”]/g, ' ')
}

/** Enough of a sentence to recognise it, without pasting a paragraph into a card. */
function trimQuote(sentence: string, limit = 90): string {
  const flat = sentence.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  const cut = flat.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** The word or phrase a pattern matched, for a finding that is about one word. */
function matchIn(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const hit = pattern.exec(text)
    if (!hit) continue
    // The hedge check reads what came immediately before the match, which is
    // why this needs the index rather than just the matched text.
    if (HEDGE_BEFORE.test(text.slice(Math.max(0, hit.index - 40), hit.index))) continue
    return hit[0]
  }
  return null
}

export function findReasoningIssues({
  paragraphs,
  thesisIndex,
  titleParagraph = false
}: ReasoningInput): ReasoningFinding[] {
  if (paragraphs.length === 0) return []

  const found: ReasoningFinding[] = []
  // At most one finding of each kind per paragraph. Three "always" in one
  // paragraph is one habit, and printing it three times buries the other six
  // findings under it — the rubric's own instruction not to invent flaws to
  // provide more feedback applies just as much to repeating a real one.
  const seen = new Set<string>()
  const push = (kind: ReasoningIssueKind, paragraphIndex: number | null, quote: string): void => {
    const key = `${kind}:${paragraphIndex}`
    if (seen.has(key)) return
    seen.add(key)
    found.push({ kind, paragraphIndex, quote })
  }

  const first = titleParagraph ? 1 : 0

  for (let i = first; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]
    const sentences = splitSentences(paragraph.text)
    if (sentences.length === 0) continue

    // --- generic opening ------------------------------------------------
    // Only the draft's first real paragraph. "Throughout history" in the middle
    // of an essay is a transition, and the finding is about how the draft
    // OPENS.
    if (i === first) {
      for (const pattern of GENERIC_OPENINGS) {
        const hit = pattern.exec(sentences[0])
        if (!hit) continue
        push('generic-opening', paragraph.index, trimQuote(sentences[0]))
        break
      }
    }

    // --- unclear reference ----------------------------------------------
    // Never the first paragraph: there is no previous paragraph for the
    // demonstrative to be reaching back into.
    if (i > first) {
      const opener = DANGLING_OPENER.exec(sentences[0])
      if (opener) push('unclear-reference', paragraph.index, trimQuote(sentences[0]))
    }

    // --- dropped evidence -----------------------------------------------
    // Two sentences minimum: a one-sentence paragraph has no "and then it
    // stopped" to observe, and a block quotation standing alone is a shape this
    // rule cannot distinguish from a deliberate epigraph.
    //
    // Excluded roles are the ones where ending on a source is not a failure to
    // analyse: a counterargument may close on the objection it is stating, and
    // a conclusion that ends on a quotation is a stylistic choice rather than a
    // missing warrant.
    const owesAnalysis =
      paragraph.role === 'evidence' || paragraph.role === 'claim' || paragraph.role === 'unknown'
    if (sentences.length >= 2 && owesAnalysis) {
      const last = sentences[sentences.length - 1]
      const isEvidence = SUBSTANTIAL_QUOTE.test(last) || TRAILING_CITATION.test(last)
      if (isEvidence) push('dropped-evidence', paragraph.index, trimQuote(last))
    }

    // --- overreaching claim / unsupported emphasis ------------------------
    // Measured on the paragraph with its quotations stripped out. A source that
    // wrote "always" wrote it; the finding is about the writer's own sentences,
    // and flagging a quotation asks a student to edit somebody else's words.
    for (const sentence of sentences) {
      const own = withoutQuotations(sentence)
      const absolute = matchIn(ABSOLUTES, own)
      if (absolute) push('overreaching-claim', paragraph.index, trimQuote(sentence))
      const emphasis = matchIn(EMPHASIS, own)
      if (emphasis) push('unsupported-emphasis', paragraph.index, trimQuote(sentence))
    }

    // --- undeveloped repetition -------------------------------------------
    // Adjacent sentences only, and both must carry real content. The threshold
    // is high (four fifths of the second sentence's vocabulary already used by
    // the first) because paraphrase for emphasis is a legitimate move and the
    // finding is about a paragraph that is not moving at all.
    for (let s = 1; s < sentences.length; s++) {
      const previous = contentWords(sentences[s - 1])
      const current = contentWords(sentences[s])
      if (previous.length < 6 || current.length < 6) continue
      if (overlapInto(current, previous) < 0.8) continue
      push('undeveloped-repetition', paragraph.index, trimQuote(sentences[s]))
      break
    }
  }

  // --- restated conclusion ------------------------------------------------
  // Needs both ends: a labelled conclusion and a located thesis. Without the
  // thesis there is nothing to compare against, and the honest output is
  // silence rather than a finding derived from the last paragraph alone.
  const conclusionAt = paragraphs.map((p) => p.role).lastIndexOf('conclusion')
  if (
    conclusionAt !== -1 &&
    thesisIndex !== null &&
    thesisIndex >= 0 &&
    thesisIndex < paragraphs.length &&
    thesisIndex !== conclusionAt
  ) {
    const conclusion = contentWords(paragraphs[conclusionAt].text)
    const thesis = contentWords(paragraphs[thesisIndex].text)
    // Twelve content words is roughly a sentence. Below that the ratio is
    // decided by three or four words and says nothing.
    if (conclusion.length >= 12 && overlapInto(conclusion, thesis) >= 0.7) {
      push('restated-conclusion', paragraphs[conclusionAt].index, trimQuote(paragraphs[conclusionAt].text))
    }
  }

  return found
}

/**
 * The 1-based paragraphs whose evidence was never analysed.
 *
 * Split out because `analyzeStructure` needs it as a VETO on `hasWarrant`
 * before the score is computed, and reaching into the finding list to filter by
 * kind at the call site would put the one detector with a score effect behind a
 * string comparison nothing tests.
 */
export function droppedEvidenceParagraphs(findings: ReasoningFinding[]): Set<number> {
  const indexes = new Set<number>()
  for (const finding of findings) {
    if (finding.kind === 'dropped-evidence' && finding.paragraphIndex !== null) {
      indexes.add(finding.paragraphIndex)
    }
  }
  return indexes
}

/** Whether the draft's conclusion merely restates its thesis. Halves the conclusion component. */
export function conclusionRestatesThesis(findings: ReasoningFinding[]): boolean {
  return findings.some((finding) => finding.kind === 'restated-conclusion')
}
