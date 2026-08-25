import type { Claim } from '@shared/types'
import { argumentParagraphs } from '@shared/structureText'
import { cosineSimilarity, embedCached } from '../ml'
import { offTopicClaimIds, type ClaimSimilarity } from '@shared/claimRelevance'

/**
 * Which detected claims are not about the rest of the draft.
 *
 * The embedding half of `shared/claimRelevance.ts` — see that file for what
 * this is for and why the threshold is what it is. Untestable by `npm test`
 * for the usual reason: it value-imports the ML worker.
 *
 * ── Against each PARAGRAPH, taking the best ────────────────────────────────
 * Not against the whole draft. Measured on a real essay, whole-draft
 * similarity does not separate a tangent from a short abstract sentence that
 * belongs — see the threshold note in shared/claimRelevance.ts. A tangent is
 * unlike EVERY paragraph, which is a question the whole-document average
 * cannot ask.
 *
 * The claim's own text is removed from each paragraph before comparing, so a
 * sentence is never scored against itself. A paragraph that is nothing BUT the
 * claim drops out entirely rather than contributing a similarity of 1.
 *
 * One batched embed call for everything. The worker round-trip dominates, so
 * this costs the same whether there is one claim or eight.
 */
export async function findOffTopicClaims(
  documentText: string,
  claims: Claim[]
): Promise<string[] | null> {
  if (claims.length === 0) return []

  // The argument, not the bibliography — a reference list is title-case noise
  // and would pull every comparison toward it. Same input the classifier gets.
  const spans = argumentParagraphs(documentText)
  const body = spans.map((s) => s.text).join('\n\n')
  if (!body.trim()) return null

  const paragraphs = spans.map((s) => s.text)
  const vectors = await embedCached([...claims.map((c) => c.text), ...paragraphs])
  // Null means the model is unavailable, which is NOT "everything belongs".
  if (!vectors) return null
  const paragraphVectors = paragraphs.map((_, i) => vectors[claims.length + i])

  const similarities: ClaimSimilarity[] = claims.map((claim, i) => {
    let best = 0
    for (const [j, paragraph] of paragraphs.entries()) {
      // A paragraph that is nothing but this claim tells us nothing — comparing
      // a sentence to itself always returns 1 and would clear any threshold.
      if (paragraph.split(claim.text).join('').trim().length === 0) continue
      best = Math.max(best, cosineSimilarity(vectors[i], paragraphVectors[j]))
    }
    return { claimId: claim.id, similarity: best }
  })

  return offTopicClaimIds(similarities, body.length)
}
