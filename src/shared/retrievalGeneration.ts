/**
 * Which generation of retrieval produced a stored search result.
 *
 * ── Why a stored result needs a version at all ─────────────────────────────
 * `cachedEvidence.ts` already versions the 24h REQUEST cache, and that is only
 * half the problem. A claim's score and its evidence rows are written into
 * SQLite and then inherited forever: `findSearchedClaimByText` matches on
 * `strength_score IS NOT NULL`, `insertClaims` copies the score, the breakdown
 * and the `claim_evidence` rows onto every future analysis of the same
 * sentence, and the editor's auto-search sweep only picks claims whose score is
 * NULL. A score of 0 is not null.
 *
 * So a claim that came back empty under an older retrieval stack was reported
 * as empty for good — the app never asked the cache, because it never asked
 * anything. Measured on the owner's database, 2026-08-21: a biography claim
 * searched at 00:36 under the previous build, three copies of it inherited
 * across re-analyses, `sourceCount: 0`, zero evidence rows, and the card
 * saying "No sources found" hours after the build that could answer it had
 * already installed. Owner: *"why does it still do this."*
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * BUMP THIS WHENEVER `findEvidence` GAINS OR LOSES A SOURCE OF RESULTS. Not
 * for a ranking tweak — the stored breakdown is re-scored on read by
 * `rescoreFromBreakdown`, so weights already flow through without this. Bump it
 * when the set of things that could come back changes, because that is when an
 * old empty answer stops being the answer.
 *
 * The cost of a bump is one re-search per affected claim, once, against a
 * request cache that is usually warm. The cost of forgetting is the failure
 * above: a retrieval improvement that never reaches the documents it was built
 * for.
 *
 * 2 — web search (#166) joined the fan-out for `general` claims: biography,
 *     history, institutions and journalism, which is everything the four
 *     academic indexes structurally cannot hold. Every claim scored before it
 *     was scored without the one provider that could answer it.
 * 1 — everything before that.
 */
export const RETRIEVAL_GENERATION = 2
