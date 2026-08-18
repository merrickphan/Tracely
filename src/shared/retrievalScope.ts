/**
 * Claims four academic search APIs were never going to hold.
 *
 * Tracely searches OpenAlex, Crossref, Semantic Scholar and PubMed. Those index
 * scholarly literature — journal articles, preprints, conference papers — and
 * that is a narrow slice of the things a student writes true sentences about.
 * When retrieval comes back with nothing, `problemKindsFor` has until now had
 * exactly one thing to say: "No supporting sources". On a claim about a school
 * district's own enrolment numbers, or about what happens on page 40 of
 * Frankenstein, or about what a statute says, or about what will happen by
 * 2035, that sentence is not a finding. It is the app reporting the shape of
 * its own corpus and phrasing it as a fault in the writing.
 *
 * Hand-labelling the eval corpus made the size of it concrete: local facts,
 * close readings, predictions, named books and statute text are STRUCTURALLY
 * unreachable here — not thinly covered, not badly ranked, absent. No retrieval
 * change reaches them, so no amount of tuning turns those flags into true ones.
 * The reweighting that landed the same week made them more visible rather than
 * less, because scores that used to sit in the middle band now sit at the
 * bottom of it.
 *
 * ── What it measures, on the 51 labelled claims ────────────────────────────
 * `support.rel` in eval/annotations is a human's count of retrieved sources
 * that actually speak to the claim, so it is the ground truth this can be
 * scored against. 18 of the 51 came back with none. This flags 7 of those 18
 * and **0 of the 33 that had sources**.
 *
 * The 11 it misses are mostly claims that SHOULD stay flagged: a fabricated
 * "Ramirez and Doyle (2024)", the visual-learners myth, a study misattributed
 * to research that says the opposite. Retrieval found nothing for those because
 * there is nothing, which is a finding about the writing and exactly what the
 * old wording was right about. Low recall here is the design working, not a gap
 * to close — every point of recall bought by a looser pattern is paid for in
 * findings withdrawn from claims that deserved them.
 *
 * The honest output is a different sentence, not a quieter one. The writer
 * still owes the reader a citation for every claim here — Tracely just stops
 * claiming to have looked for it in a place it could never have been.
 *
 * ── Precision over recall, deliberately ────────────────────────────────────
 * A false positive here SILENCES a real finding: a genuinely unsupported claim
 * gets excused as "outside these databases" and the writer is told to cite
 * something that does not exist. A false negative just leaves today's
 * behaviour in place. So every pattern below requires an explicit, hard-to-
 * write-by-accident marker, and none of them fire on ordinary academic prose.
 * `null` — "as far as this can tell, the databases should have had something"
 * — is the default and the common answer.
 *
 * A leaf module: type-only imports, so `npm test` can load it.
 */

export type OutOfScopeReason =
  /** A close reading — what a named novel, play, poem or film does. */
  | 'primary-text'
  /** What a statute, article, clause or case says. */
  | 'legal-text'
  /** One institution's or place's own records. */
  | 'local-fact'
  /** Something that has not happened yet. */
  | 'prediction'
  /** The writer's own experience or observation. */
  | 'personal'

/**
 * Forward-looking markers only — never a bare "will".
 *
 * "This will be shown below" and "the argument will turn on" are ordinary
 * essay scaffolding, and matching `\bwill\b` labelled roughly a third of every
 * draft a prediction. What is actually out of scope is a claim about a state of
 * the world at a future date, and every pattern here names the future
 * explicitly.
 */
const PREDICTION = [
  /\bby (?:20[2-9]\d|the (?:end|middle) of (?:the )?(?:decade|century))\b/i,
  /\b(?:in|over|within) the (?:next|coming) (?:few )?(?:year|decade|century|month)s?\b/i,
  // "a debt crisis within the decade is unavoidable" — no "next", same claim.
  /\bwithin the (?:decade|century)\b/i,
  /\bis (?:projected|forecast|forecasted|expected|predicted|set) to\b/i,
  /\bare (?:projected|forecast|forecasted|expected|predicted|set) to\b/i,
  /\bwill (?:likely |probably |eventually |soon )?(?:continue|become|reach|rise|fall|double|halve|overtake|replace|disappear)\b/i
]

/**
 * The vocabulary of a close reading. Every one of these is a statement about
 * the primary text itself, which the scholarly indexes hold criticism OF but
 * not the content of.
 */
const PRIMARY_TEXT = [
  /\bthe (?:novel|novella|play|poem|film|memoir|short story)\b/i,
  /\bthe (?:narrator|protagonist|speaker|author)\b/i,
  /\b(?:chapter|stanza|canto) \d+\b/i,
  // Capitalised on purpose: lowercase "act" is an ordinary verb and noun, and a
  // roman numeral after it is not enough to carry the match on its own.
  /\bAct [IVX]+\b/,
  /\bscene \d+\b/i,
  /\b(?:opening|closing|final) (?:chapter|scene|stanza|lines?|paragraph)\b/i,
  // "Nancy Hoffman's Schooling in the Workplace argues that …" — a named book's
  // own argument. Monographs are indexed thinly and inconsistently by all four
  // providers; an article about the book is what comes back, if anything.
  /\b[A-Z][\w'’-]+(?:['’]s) [A-Z][\w'’-]+(?: [\w'’-]+){0,5} (?:argues|contends|claims|shows|describes)\b/
]

/**
 * Publication history is NOT a close reading, and this veto is why.
 *
 * "The novel was published anonymously in 1818, and the revised 1831 edition
 * carries a new preface" tripped `the novel` and was excused as unreachable —
 * on a claim with five relevant sources in the corpus, because a work's
 * printing history is exactly the kind of bibliographic fact scholarship is
 * made of. The distinction that matters is between a claim about what happens
 * INSIDE a text and a claim about the text as an object in the world; only the
 * first is unreachable.
 */
const BIBLIOGRAPHIC =
  /\b(?:published|publication|edition|editions|preface|printed|reprinted|translated|translation|serialised|serialized|manuscript|circulation|print run|sold|banned|reviewed|adapted)\b/i

/**
 * The TEXT of a law, and nothing else.
 *
 * This started out matching named statutes ("the Clean Air Act") and case names
 * ("Brown v. Board"), and both were wrong in the same way: legal SCHOLARSHIP is
 * indexed heavily. Tinker v. Des Moines and Hazelwood v. Kuhlmeier returned
 * seven and ten relevant sources respectively in the corpus, and both were
 * being excused as unsearchable. What genuinely came back empty was
 * "Education Code section 48907 protects student expression unless…" — a claim
 * about what a provision SAYS, which lives in the statute book and not in a
 * journal.
 *
 * So the surviving patterns all name a provision, and the ones that merely
 * named a law or a case are gone.
 */
const LEGAL_TEXT = [
  /§/,
  /\b(?:section|article|clause|subsection) \d+(?:\(\w+\))?\b/i,
  /\b\d+\s*U\.?S\.?C\.?\b/
]

/**
 * One institution's own numbers. Possessive and first-person-plural forms only:
 * "our district", "the school's", "the council". A bare "schools" or "the city"
 * is a general claim the literature may well speak to.
 */
const LOCAL_FACT = [
  /\bour (?:school|district|city|town|county|campus|company|team|club|library|council|department|classes?)\b/i,
  /\bthe (?:school|district|council|committee|administration|principal|superintendent)'s\b/i,
  /\bat (?:my|our) (?:school|college|university|workplace|company|library)\b/i,
  /\b[A-Z][\w'-]+(?: [A-Z][\w'-]+)* (?:High School|Middle School|Elementary School|Public Library|City Council|Town Council|School Board)\b/,
  // Verb-anchored, so "the council" alone never fires: a bare noun is often the
  // general subject of a policy essay, while "the council voted last year" is a
  // minute from one meeting in one town.
  /\bthe (?:city |town )?(?:council|board|committee) (?:voted|approved|rejected|passed|adopted|decided)\b/i
]

const PERSONAL = [
  /\b(?:I|we) (?:saw|noticed|found|observed|remember|watched|counted|asked|spoke)\b/,
  /\b(?:I|we) have (?:seen|noticed|found|observed|watched)\b/,
  /\bin my (?:own )?(?:experience|class|classroom|school|job|case)\b/i,
  /\bmy (?:own )?(?:classmates|students|coworkers|colleagues|family)\b/i,
  /\bwhen I (?:was|worked|started|arrived)\b/i
]

/**
 * Order matters only where a sentence could match twice, and then it reports
 * the more specific reason. A close reading that also says "I noticed" is still
 * a close reading; a statute quoted in a personal anecdote is still a statute.
 */
const RULES: Array<[OutOfScopeReason, RegExp[]]> = [
  ['legal-text', LEGAL_TEXT],
  ['primary-text', PRIMARY_TEXT],
  // `personal` above `local-fact`: a sentence can trip both ("...at my school
  // it feels like nobody does" carries an institution AND a first-person
  // observation), and "say plainly that this is your own" is better advice on
  // such a sentence than "cite the record", which there is no record of.
  ['personal', PERSONAL],
  ['local-fact', LOCAL_FACT],
  ['prediction', PREDICTION]
]

/**
 * Why these four indexes were never going to carry this sentence, or null if
 * they should have.
 *
 * Deterministic, local and free — the same stance `scoring.ts` and
 * `scoreDraft.ts` take, and for the same reason: this decides whether a student
 * is told their claim is unsupported, and a decision like that has to be one
 * they can look at and argue with. It is also asked on every claim of every
 * poll tick in Screen Watch, where a relay call is not on the table.
 */
export function retrievalScopeFor(text: string): OutOfScopeReason | null {
  for (const [reason, patterns] of RULES) {
    if (!patterns.some((pattern) => pattern.test(text))) continue
    // The one veto, and it applies to one reason. See BIBLIOGRAPHIC.
    if (reason === 'primary-text' && BIBLIOGRAPHIC.test(text)) continue
    return reason
  }
  return null
}
