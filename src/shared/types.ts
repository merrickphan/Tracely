export type ClaimType = 'statistic' | 'causal' | 'factual' | 'prediction' | 'opinion'

// A signed-in Supabase account. Entirely separate from Profile (local
// display name/avatar) — this is the real, server-verified unique identity;
// null means signed out / no account configured.
export interface AuthUser {
  id: string
  email: string | null
  // Google sign-in populates this from the Google account automatically;
  // email/password sign-up asks for it explicitly (see AuthSignUpRequest)
  // since Supabase has no built-in name field. Null means "not set yet" —
  // the renderer should prompt for it before showing the main app rather
  // than ever rendering a blank greeting.
  firstName: string | null
  // Defaults to email until the user picks something else (see
  // updateUsername) — that default is also exactly what a Google account
  // already has, so "Google sign-in gets email as a username" needs no
  // separate handling. Null only for the placeholder case of no email
  // either (shouldn't happen in practice — every Supabase auth method here
  // collects an email).
  username: string | null
}

export type CitationStyle = 'APA' | 'MLA' | 'Chicago'

export type CritiqueVerdict =
  | 'contradicted'
  /**
   * The sentence attributes a claim to a source that does not appear to exist.
   *
   * Distinct from `contradicted` (a real fact, asserted wrongly) and from
   * `unsupported` (nothing found either way, may still be true). Filing a
   * fabricated reference as `unsupported` puts the most serious thing a draft
   * can do in the same bucket as a claim nobody has studied yet, and reads back
   * to the writer as "may still be true" — see eval/RUBRIC.md.
   *
   * Carries an obligation, the mirror of `miscited`'s `citedSource.says`: a
   * verdict of `fabricated` must record what was searched for and not found, or
   * it is an accusation rather than a finding.
   */
  | 'fabricated'
  /**
   * The substance is defensible; the phrasing is not.
   *
   * "People are 100% dangerous to the environment" is not false so much as
   * unarguable as written — no evidence could support the quantifier. Folding
   * this into `weak` told students to find better sources for a sentence whose
   * problem was one word, and sending them looking for evidence that cannot
   * exist is worse advice than saying nothing.
   *
   * Paired with `CritiqueResult.suggestedRevision`, which carries the same
   * sentence with only its quantifier changed. The verdict without the
   * revision is a complaint; the pair is a fix.
   */
  | 'overstated'
  | 'well-supported'
  | 'partially-supported'
  | 'weak'
  | 'unsupported'

// 'reference' exists because not every checkable claim is a scientific one. A
// date, a definition, or what an organisation does is answered by an
// encyclopedia, and answered badly by the peer-reviewed literature — the
// labelled baseline retrieved transistor lithography papers for a claim about
// the printing press.
export type VenueType =
  | 'journal'
  /** Primary statistical series published by an authoritative institution. */
  | 'dataset'
  | 'conference'
  | 'preprint'
  | 'book'
  /** Tertiary reference work. Useful orientation, not citable evidence. */
  | 'reference'
  | 'other'

export type SourceProvider =
  | 'openalex'
  | 'crossref'
  | 'semanticscholar'
  | 'pubmed'
  | 'wikipedia'
  | 'worldbank'
  | 'manual'

export interface Author {
  given?: string
  family: string
}

export interface Claim {
  id: string
  analysisId: string
  text: string
  claimType: ClaimType
  confidence: number
  searchQuery: string
  strengthScore: number | null
  scoreBreakdown: ScoreBreakdown | null
  critique: string | null
  critiqueVerdict: CritiqueVerdict | null
  /**
   * The two halves of a critique that are a FIX rather than a finding — the
   * narrowed sentence and the corrected reference. `CritiqueResult`'s fields of
   * the same names, written down.
   *
   * Persisted because the popover over a marked sentence needs them and has only
   * a stored `Claim` to read. They have been on the critique IPC *response*
   * since the relay learned to produce them, so `ClaimCard` — which fires the
   * critique itself and holds the response — could show them; nothing wrote them
   * down. Hovering the underline that same critique produced found a verdict of
   * "overstated" with the narrowed sentence that gives it its meaning already
   * gone. Screen Watch never hit this: it keeps its claims in memory and never
   * reads them back out of SQLite.
   */
  suggestedRevision: string | null
  citationFix: string | null
  createdAt: string
}

export interface Analysis {
  id: string
  sourceText: string
  origin: 'main' | 'floating'
  createdAt: string
}

export interface ScoreBreakdown {
  sourceCount: number
  quality: number
  recency: number
  relevance: number
  /** Balance of sources that support the claim against those that contradict
   *  it. 0 when no source was confidently either — which is different from,
   *  and much more common than, being contradicted. */
  support: number
}

export interface Source {
  id: string
  doi: string | null
  title: string
  authors: Author[]
  year: number | null
  venue: string | null
  venueType: VenueType | null
  url: string | null
  pdfUrl: string | null
  abstract: string | null
  provider: SourceProvider
  providerId: string | null
  citationCount: number | null
  oaStatus: string | null
  createdAt: string
}

/** Whether a source agrees with the claim it was found for. `null` on
 *  EvidenceItem means the question was never answered — the model was
 *  unavailable, or the source did not clear the relevance bar — which is
 *  different from 'unclear', where it was asked and the answer was "this is
 *  not evidence either way". */
export type EvidenceStance = 'supports' | 'contradicts' | 'unclear'

export interface EvidenceItem {
  source: Source
  relevanceScore: number
  rank: number
  stance: EvidenceStance | null
  stanceConfidence: number | null
}

export interface Citation {
  id: string
  sourceId: string
  style: CitationStyle
  formattedText: string
  createdAt: string
}

export interface LibraryItem {
  id: string
  sourceId: string
  claimId: string | null
  notes: string | null
  tags: string[]
  savedAt: string
  source: Source
}

// Tracer — the teaching assistant you open from the Screen Watch widget.
// Unlike the rest of Screen Watch (which deliberately persists nothing, see
// screenWatchService.ts), these conversations DO get written to SQLite: the
// point of a tutor is that it remembers what it already walked you through.
export type TracerRole = 'user' | 'tracer'

export interface TracerMessage {
  id: string
  conversationId: string
  role: TracerRole
  content: string
  createdAt: string
}

export interface TracerConversation {
  id: string
  // First user message, truncated — used as the label in the history list.
  title: string
  createdAt: string
  updatedAt: string
}

export type Theme = 'light' | 'dark' | 'system'

export type AccentColor = 'orange' | 'blue' | 'green' | 'purple'

export type Density = 'comfortable' | 'compact'

export type FontSize = 'small' | 'medium' | 'large'

export interface AppSettings {
  defaultCitationStyle: CitationStyle
  hotkeyAccelerator: string
  enableStrengthSummaries: boolean
  theme: Theme
  accentColor: AccentColor
  density: Density
  fontSize: FontSize
  // 0-1, higher = fewer/more-confident-only claims underlined. Exposed to
  // the user instead of a value we keep re-tuning ourselves in code.
  claimSensitivity: number
  screenWatchHotkeyAccelerator: string
  // Opt-in: apps this exe list contains are the ONLY ones Screen Watch
  // reads text from. Empty means nothing is enabled anywhere yet.
  screenWatchAllowedApps: string
  /** The Save changes dialog's "Do not show anymore" has been ticked. */
  suppressSaveConfirm: boolean
  /**
   * The school year the writing is graded against, 3-12.
   *
   * It moves the LETTER, never the /100 — see shared/gradeLevel.ts. Defaults to
   * 12, which is the level the bands were written against, so an install that
   * has never touched this grades exactly as it did before the setting existed.
   */
  gradingLevel: number
}

// The document editor's saved work. Rich text rather than plain: the editor is
// an execCommand surface (bold/italic/colour/alignment), so storing plain text
// would discard every bit of formatting on the first reload.
export interface DocumentRecord {
  id: string
  title: string
  bodyHtml: string
  createdAt: string
  updatedAt: string
}

/**
 * A document as the Documents page lists it — Figma "DocumentsPage" (58:172).
 *
 * The grade and the date it was earned are joined from `document_structure`,
 * not stored on the document: that table already caches the outline (score
 * included) and when it was analysed, so the card's chip and its "Graded May
 * 19, 2026" line are two reads of a row that already exists. Deriving them here
 * rather than denormalising onto `documents` is what keeps one score per draft
 * — the alternative is a copy that goes stale the moment the draft is edited
 * and re-analysed.
 *
 * Both null for a document nothing has read yet, which is a normal state and
 * not an error: the card then draws no chip and says so, rather than showing a
 * letter nothing computed.
 */
export interface DocumentListItem extends DocumentRecord {
  /** 0-100, the same number ArgumentScoreModal shows. Null when never analysed. */
  score: number | null
  /** ISO timestamp of the analysis the score came from. */
  gradedAt: string | null
}

// What a paragraph is DOING in the argument, which is a different question from
// what it says. The vocabulary is the one composition instructors already use,
// so a label is something a student can act on rather than jargon to decode.
//
// 'unknown' is load-bearing and must never be treated as a role. It means the
// question was not answered — no classifier ran, or it declined this paragraph
// — which is different from "this paragraph does nothing". The score reports
// itself as provisional whenever any paragraph carries it, rather than quietly
// scoring an unlabelled essay as if it had been read.
export type ParagraphRole =
  | 'thesis'
  | 'claim'
  | 'evidence'
  | 'reasoning'
  | 'significance'
  | 'counterargument'
  | 'conclusion'
  | 'transition'
  | 'unknown'

export interface ParagraphOutline {
  /** 1-based, matching the numbering the classifier is shown. */
  index: number
  role: ParagraphRole
  // Whether the paragraph explains how its evidence bears on its claim. Until
  // the relay classifier ships this is a marker heuristic, and `rolesFrom`
  // says which it was — see DocumentOutline.
  hasWarrant: boolean
  /**
   * Whether the paragraph asserts a contestable sub-point of its own.
   *
   * A separate axis from `role`, because a paragraph carries one role and can
   * be governed by a claim whatever that role is — the paragraph that opens
   * with a sub-point and then cites three studies for it is `evidence` and
   * claim-governed at the same time. See ReconciledRoles.statesClaim.
   *
   * Optional because it postdates the outlines already in the database.
   * Undefined is not "false": every consumer must fall back to
   * `role === 'claim'`, which is what `governingClaims` counted before this
   * existed, so a stored outline keeps scoring exactly as it did.
   */
  statesClaim?: boolean
  /** Claims detected inside this paragraph, by id. Empty is normal. */
  claimIds: string[]
}

export interface StructureComponents {
  thesis: number
  governingClaims: number
  warrant: number
  counterargument: number
  significance: number
  conclusion: number
}

export type StructureWeaknessKind =
  | 'no-thesis'
  | 'warrant-gap'
  | 'evidence-stacking'
  | 'no-counterargument'
  | 'unsupported-claim'
  | 'new-claim-in-conclusion'
  | 'no-significance'

export interface StructureWeakness {
  kind: StructureWeaknessKind
  /** 1-based paragraph this is about, or null when it is about the whole draft. */
  paragraphIndex: number | null
  claimId: string | null
  /** Built from a local template. Never model prose — see structure/weaknesses.ts. */
  message: string
  /** Prefilled into Tracer when the user asks about this weakness. */
  tracerPrompt: string
}

export type CohesionFindingKind = 'no-transition' | 'topic-jump' | 'unanswered-counterargument'

export interface CohesionFinding {
  kind: CohesionFindingKind
  /** 1-based paragraph the boundary runs FROM. */
  fromIndex: number
  /** 1-based paragraph the boundary runs TO. */
  toIndex: number
  /** Local template. Never model prose, and never the draft's own words. */
  message: string
}

/**
 * How well the draft's paragraphs join up — see structure/cohesion.ts.
 *
 * Reported BESIDE the /100 rather than inside it, the same call
 * `evidenceCoverage.ts` makes: the rubric's six components are about whether
 * the argument's parts exist, and folding a seventh number in would silently
 * re-weight a score whose breakdown is shown to the student.
 */
export interface DraftCohesion {
  /** 0-100, the mean of every paragraph boundary. 100 when there is only one. */
  score: number
  boundaries: number
  findings: CohesionFinding[]
}

export interface EvidenceCoverage {
  detected: number
  /**
   * Claims Tracely's OWN search found a relevant source for.
   *
   * Not the same as "claims that have a source" — see `withOwnCitation`. This
   * number is only ever about what retrieval turned up.
   */
  withRelevantSource: number
  /**
   * Claims the writer already cited themselves, detected by
   * `hasInlineCitation` over the claim sentence.
   *
   * Counted separately and never merged into `withRelevantSource`, because they
   * answer different questions and only this one is about the draft rather than
   * about Tracely. Reporting coverage without it was the defect: a meticulously
   * cited essay read as "0 of 7 claims have a source", since retrieval had
   * either not run or not happened to surface the same paper the writer used.
   */
  withOwnCitation: number
  /** Mean strengthScore over claims whose search has resolved; null if none have. */
  meanStrength: number | null
  unchecked: number
  /**
   * Claims four scholarly indexes were never going to hold — a close reading, a
   * statute, one institution's own records, the writer's own observation, a
   * prediction. See retrievalScope.ts.
   *
   * A fourth separate number for the same reason the other three are separate:
   * folded into `withRelevantSource` it would read as a retrieval failure, and
   * folded into `unchecked` it would read as work still to do. It is neither.
   * The denominator this belongs OUT of is "claims Tracely could meaningfully
   * search", which is what the report subtracts it from.
   *
   * Optional because it postdates the stored outlines. Undefined means "not
   * measured", and every consumer must render that as zero disclosure rather
   * than as zero out-of-scope claims.
   */
  outsideIndexes?: number
}

// Deliberately holds NO prose from the document — only indices, roles, booleans
// and claim ids. Three consequences, all wanted: the persisted row stays tiny;
// there is no copy of the user's writing to reason about when Privacy clears
// run; and the renderer is forced to join these labels onto the live editor
// text, so an outline computed against older text renders visibly wrong rather
// than looking authoritative over stale content it carries with it.
export interface DocumentOutline {
  /** Null for an unsaved document being analyzed before its first autosave. */
  documentId: string | null
  /**
   * The analysis whose claims the paragraph `claimIds` refer to.
   *
   * Stored so reopening a document can fetch those claims back and show their
   * evidence state. Without it a restored outline knows claims exist and has no
   * way to say anything about them — the ids alone are not resolvable.
   * An id, not prose, so it does not breach the no-text rule below.
   */
  analysisId: string | null
  /** Hash of the text this was computed from. Compare to detect staleness. */
  sourceHash: string
  schemaVersion: number
  paragraphs: ParagraphOutline[]
  /** 0-100. Deterministic given `paragraphs` — see structure/scoreDraft.ts. */
  score: number
  components: StructureComponents
  /** False when any paragraph is 'unknown'. The UI must say "provisional". */
  complete: boolean
  /**
   * Always true. It once meant "the draft is too short for the rubric to
   * measure, do not render a number" — see `applicable` in scoreDraft.ts for
   * the case that produced it and the call that removed it.
   *
   * Kept rather than deleted because `src/shared/*` is additive (CLAUDE.md),
   * and because a consumer reading it still gets a correct answer: every draft
   * is gradeable now.
   */
  applicable: boolean
  rolesFrom: 'heuristic' | 'model'
  coverage: EvidenceCoverage
  weaknesses: StructureWeakness[]
  /**
   * Null on outlines computed before cohesion existed. Restored rows are
   * filtered by `schemaVersion` so this is only ever null for an outline built
   * by an older client, but the UI must still tolerate it rather than render a
   * flow score of zero for a draft nothing measured.
   */
  cohesion: DraftCohesion | null
  /**
   * Whether `paragraphs[0]` is the document's TITLE rather than a paragraph of
   * the argument.
   *
   * `splitParagraphs` breaks on any newline run, so a titled essay arrives with
   * its heading as paragraph 1. Main already has to know this — the thesis is
   * read from the paragraph after it, and it must not count as a paragraph
   * nothing could read — and the surfaces need the same answer to avoid listing
   * a heading as "P1 · Unlabelled" in a breakdown of the argument.
   *
   * Optional because outlines persisted before this existed do not carry it;
   * absent reads as false, which is the old behaviour.
   */
  titleParagraph?: boolean
  analyzedAt: string
}
