// Message contract between the main thread and the ML worker.
//
// Kept in its own module because both sides import it and the worker is built
// as a separate entry point — a type that lived in either one would drag that
// side's imports into the other's bundle.

/** Sentence-transformer used for dense relevance. Swappable: the eval harness
 *  is the arbiter, not intuition. all-MiniLM-L6-v2 is the measured starting
 *  point (384 dims, ~23MB quantised, ~10ms per text in Electron). */
export const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
export const EMBED_DIM = 384

/**
 * NLI model used to ask whether a source agrees with a claim.
 *
 * Chosen by measurement, not reputation. Against twelve hand-written
 * (claim, finding) pairs it caught 3 of 4 contradictions, and its one miss was
 * a null result ("no significant difference"), which is arguably not a
 * contradiction at all. The obvious alternative, distilbert-base-uncased-mnli,
 * scored the same overall but caught 1 of 4 — and called a real contradiction
 * "support" at 0.99 confidence, which is precisely the failure that would tell
 * a student their wrong claim is right.
 */
export const STANCE_MODEL_ID = 'Xenova/nli-deberta-v3-xsmall'

export type Stance = 'supports' | 'contradicts' | 'unclear'

export interface StanceVerdict {
  stance: Stance
  /** Probability of the winning class. Callers threshold on this; the worker
   *  deliberately does not, so the bar can be tuned without a rebuild. */
  confidence: number
}

export interface MlWorkerData {
  /** Where transformers.js may write downloaded weights. Must be writable —
   *  node_modules is read-only inside a packaged app. */
  cacheDir: string
  /** Weights shipped in the installer, when present. */
  localModelPath: string | null
  /** False once weights ship with the app, so a packaged build never reaches
   *  the network for a model and never silently blocks on a download. */
  allowRemote: boolean
}

export interface EmbedRequest {
  id: number
  op: 'embed'
  texts: string[]
}

export interface StanceRequest {
  id: number
  op: 'stance'
  claim: string
  passages: string[]
}

export type MlRequest = EmbedRequest | StanceRequest

export interface EmbedSuccess {
  id: number
  op: 'embed'
  ok: true
  /** Flat batch × dim buffer; the host slices it. Transferred rather than
   *  cloned, so the batch size doesn't cost a copy. */
  data: Float32Array
  dim: number
}

export interface StanceSuccess {
  id: number
  op: 'stance'
  ok: true
  verdicts: StanceVerdict[]
}

export interface MlFailure {
  id: number
  ok: false
  error: string
}

export type MlResponse = EmbedSuccess | StanceSuccess | MlFailure
