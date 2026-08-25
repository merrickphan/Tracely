/**
 * How many sources a writer is offered for one claim.
 *
 * Owner, 2026-08-19: *"limit article choices to maximum 5 instead of like 10."*
 * Lives here rather than in `search/aggregator.ts` because the cap has to hold
 * on BOTH paths and the two are far apart — the aggregator applies it to a
 * fresh search, and `claimEvidenceRepo` applies it when reading rows a previous
 * search persisted.
 *
 * That second one is why the cap appeared not to work. `linkEvidence` upserts
 * per (claim, source), so the sixteen rows an older search wrote are still
 * there after a re-search returns five, and the citation picker reads STORED
 * rows rather than re-running the providers. Capping only the search left every
 * already-searched claim showing its old list.
 *
 * Five, not ten, because this is a list someone picks a citation from: past
 * about five the extra rows are not more choice, they are more to reject.
 *
 * A leaf with no imports.
 */
export const MAX_EVIDENCE_RESULTS = 5

/**
 * Shortest text Home's source finder will search for.
 *
 * Below this there is nothing to rank against: dense relevance compares the
 * user's text to each candidate, and three words produce a vector that matches
 * everything equally. Refusing is more useful than returning noise.
 */
export const MIN_EVIDENCE_TEXT_CHARS = 25

/**
 * How many sources Home's finder shows.
 *
 * Wider than the editor's picker (MAX_EVIDENCE_RESULTS) on purpose: there the
 * writer is choosing ONE source to cite in a sentence, and a long list is a
 * decision they did not ask for. Here the list IS the answer.
 */
export const MAX_TEXT_SOURCE_CANDIDATES = 8
