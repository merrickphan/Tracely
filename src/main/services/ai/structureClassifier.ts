import { createHash } from 'node:crypto'
import { getCached, setCached } from '../storage/cacheRepo'
import { callRelay } from './client'
import {
  MAX_STRUCTURE_INPUT_CHARS,
  MAX_STRUCTURE_PARAGRAPH_CHARS,
  MAX_STRUCTURE_PARAGRAPHS
} from './costGuard'
import { buildStructurePrompt, reconcileRoles, type ReconciledRoles } from './structureRoles'

/**
 * Asks the relay what each paragraph is doing.
 *
 * ── NOT YET REACHABLE ──────────────────────────────────────────────────────
 * `endpoint` is typed as `callRelay`'s own endpoint union, which does NOT
 * currently contain 'classify-structure'. That makes this function impossible
 * to call: there is no value a caller can pass. That is deliberate, and it is
 * the safe half of a two-repo change.
 *
 * `scripts/preflight.mjs` parses that union literal out of client.ts and
 * refuses to publish unless every endpoint in it answers something other than
 * a 404 in production. Widening it before `api/classify-structure.ts` is
 * deployed would therefore block EVERY release of the app, including ones with
 * nothing to do with this feature — the v0.3.73 incident inverted.
 *
 * To turn this on, in this order:
 *   1. Deploy the relay (the endpoint is committed on feat/classify-structure).
 *   2. Add 'classify-structure' to the union in client.ts:100.
 *   3. Call this from structureHandlers and pass the result to
 *      analyzeStructure's `classified` input.
 * Step 2 is what preflight then verifies for you.
 * ───────────────────────────────────────────────────────────────────────────
 */
export type RelayEndpoint = Parameters<typeof callRelay>[0]

const CACHE_TYPE = 'ai:classifyStructure'

function cacheKey(prompt: string): string {
  // Keyed on the assembled prompt rather than the raw document: two drafts
  // that truncate to the same numbered text genuinely produce the same
  // labelling, and that is the only thing the model sees. The v-prefix is the
  // invalidation lever — bump it when the prompt or the role vocabulary
  // changes, exactly as claimDetection.ts does.
  return createHash('sha256').update(`ai:classifyStructure::v1::${prompt}`).digest('hex')
}

/**
 * Returns model-assigned roles, or null when the classification could not be
 * obtained — a relay failure, no relay configured, or an empty document.
 *
 * Null rather than a throw, because the caller has a genuinely good fallback:
 * the local heuristics. A structural read that silently degrades to "labelled
 * by local rules" (and says so in the panel) is much better than one that
 * fails the whole analysis because a network call did.
 */
export async function classifyStructure(
  endpoint: RelayEndpoint,
  paragraphTexts: string[]
): Promise<ReconciledRoles | null> {
  if (paragraphTexts.length === 0) return null

  const prompt = buildStructurePrompt(paragraphTexts, {
    maxParagraphs: MAX_STRUCTURE_PARAGRAPHS,
    maxParagraphChars: MAX_STRUCTURE_PARAGRAPH_CHARS,
    maxInputChars: MAX_STRUCTURE_INPUT_CHARS
  })
  if (!prompt) return null

  const key = cacheKey(prompt)
  const cached = getCached<ReconciledRoles>(key)
  // Re-analysing an unchanged draft is free, which is what makes an always-
  // available "Re-analyze" button reasonable to offer.
  if (cached) return cached

  try {
    const raw = await callRelay<unknown>(endpoint, { text: prompt })
    // reconcileRoles is told how many paragraphs the DOCUMENT has, not how
    // many were sent. Paragraphs dropped by the caps come back 'unknown',
    // which is the honest label for "never looked at" and keeps the vector
    // aligned with the document rather than with the request.
    const roles = reconcileRoles(raw, paragraphTexts.length)
    setCached(key, CACHE_TYPE, roles)
    return roles
  } catch (error) {
    console.warn('[structure] classification failed, falling back to heuristics', error)
    return null
  }
}
