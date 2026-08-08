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

export type MlRequest = EmbedRequest

export interface MlSuccess {
  id: number
  ok: true
  /** Flat batch × dim buffer; the host slices it. Transferred rather than
   *  cloned, so the batch size doesn't cost a copy. */
  data: Float32Array
  dim: number
}

export interface MlFailure {
  id: number
  ok: false
  error: string
}

export type MlResponse = MlSuccess | MlFailure
