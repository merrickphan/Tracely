import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import { Worker } from 'worker_threads'
import { getAppPaths } from '../storage/paths'
import {
  EMBED_DIM,
  type MlRequest,
  type MlResponse,
  type MlWorkerData,
  type StanceVerdict
} from './protocol'

export type { Stance, StanceVerdict } from './protocol'

// The first request pays for loading ~23MB of weights plus the onnxruntime
// binary; later ones are ~10ms. One generous ceiling for the cold case and a
// tight one after, so a wedged worker can't hold an analysis open indefinitely
// but a slow laptop's first call isn't killed for being slow.
const COLD_TIMEOUT_MS = 120_000
const WARM_TIMEOUT_MS = 20_000

let worker: Worker | null = null
let unavailable = false
let everSucceeded = false
let nextId = 1

interface Pending {
  resolve: (value: MlResponse) => void
  timer: NodeJS.Timeout
}
const pending = new Map<number, Pending>()

function resolveWorkerData(): MlWorkerData {
  const { dataDir, resourcesDir } = getAppPaths()
  // Mirrors how db.ts locates sql-wasm.wasm: shipped alongside the app when
  // packaged, fetched on demand in development. cacheDir must live under the
  // app data dir either way — node_modules is read-only once packaged, so a
  // download target inside it would fail for every real user.
  const bundled = resourcesDir ? join(resourcesDir, 'models') : null
  const hasBundled = bundled !== null && existsSync(bundled)
  return {
    cacheDir: join(dataDir, 'models'),
    localModelPath: hasBundled ? bundled : null,
    allowRemote: !hasBundled
  }
}

function workerScriptPath(): string {
  // The eval harness is not the packaged main process: scripts/evaluate.mjs
  // bundles the harness on its own into out/eval/, so the worker emitted
  // beside the main bundle is not there. Without an override the harness would
  // fall back to lexical scoring and report that embeddings changed nothing —
  // a silent false negative in the one measurement that gates this work.
  const override = process.env.TRACELY_ML_WORKER
  if (override) return override

  // Built as a separate entry (see electron.vite.config.ts) beside the main
  // bundle.
  return join(__dirname, 'mlWorker.js')
}

function disable(reason: string, error?: unknown): void {
  if (!unavailable) {
    console.warn(`[ml] disabled — ${reason}`, error ?? '')
  }
  unavailable = true
  worker = null
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.resolve({ id, ok: false, error: reason })
  }
  pending.clear()
}

function ensureWorker(): Worker | null {
  if (unavailable) return null
  if (worker) return worker

  const scriptPath = workerScriptPath()
  if (!existsSync(scriptPath)) {
    disable(`worker bundle missing at ${scriptPath}`)
    return null
  }

  try {
    const next = new Worker(scriptPath, { workerData: resolveWorkerData() })

    next.on('message', (response: MlResponse) => {
      const entry = pending.get(response.id)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(response.id)
      if (response.ok) everSucceeded = true
      entry.resolve(response)
    })

    // A crashed worker must not take the app with it, and must not leave
    // callers hanging — both handlers resolve every in-flight request.
    next.on('error', (error) => disable('worker error', error))
    next.on('exit', (code) => {
      if (code !== 0) disable(`worker exited with code ${code}`)
    })

    // Inference is an enhancement, never a reason the process can't quit.
    next.unref()

    worker = next
    return worker
  } catch (error) {
    disable('worker failed to start', error)
    return null
  }
}

function send(request: MlRequest, active: Worker): Promise<MlResponse> {
  const id = request.id
  return new Promise<MlResponse>((resolve) => {
    const timer = setTimeout(
      () => {
        pending.delete(id)
        resolve({ id, ok: false, error: 'timed out' })
      },
      everSucceeded ? WARM_TIMEOUT_MS : COLD_TIMEOUT_MS
    )
    pending.set(id, { resolve, timer })
    active.postMessage(request)
  })
}

/**
 * Embeds each text, returning L2-normalised vectors — a plain dot product of
 * two results is their cosine similarity.
 *
 * Returns `null` rather than throwing when the model is unavailable for any
 * reason: missing bundle, failed load, timeout, low-end machine. Every caller
 * is expected to fall back to lexical scoring, because a student whose laptop
 * can't run this must still get search results, just less well ranked ones.
 */
export async function embed(texts: string[]): Promise<Float32Array[] | null> {
  if (texts.length === 0) return []

  const active = ensureWorker()
  if (!active) return null

  const response = await send({ id: nextId++, op: 'embed', texts }, active)

  if (!response.ok) {
    console.warn(`[ml] embed failed — ${response.error}`)
    return null
  }
  if (response.op !== 'embed') return null

  const { data, dim } = response
  if (dim !== EMBED_DIM || data.length !== texts.length * dim) {
    // A dimension change means the model changed, which invalidates every
    // cached vector. Better to fall back loudly than to silently compare
    // vectors from two different models.
    console.warn(`[ml] unexpected embedding shape: ${data.length} values, dim ${dim}`)
    return null
  }

  const vectors: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    vectors.push(data.subarray(i * dim, (i + 1) * dim))
  }
  return vectors
}

/** Dot product of two normalised vectors, i.e. cosine similarity. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

// Deliberately in memory rather than the SQLite table the plan called for.
//
// Two things killed the table. Candidates are embedded inside findEvidence,
// before any of them exist as `sources` rows — only the eight that survive the
// cut are upserted afterwards — so there is no source_id to key on at the
// point the vector is actually needed. And sql.js has no incremental write
// path: persist() serialises the entire database on every write, so 1536 bytes
// per paper would tax every unrelated write in the app, forever, growing with
// the library. The thing it would buy is 1.6ms of recomputation.
//
// The arithmetic changes at Phase 3, where passage-level embedding means
// hundreds of chunks per paper rather than one. Revisit it there, not here.
const EMBED_CACHE_MAX = 2000
const embedCache = new Map<string, Float32Array>()

function cacheKey(text: string): string {
  return createHash('sha256').update(text).digest('base64')
}

function remember(key: string, vector: Float32Array): void {
  // Map iterates in insertion order, so the first key is the oldest.
  if (embedCache.size >= EMBED_CACHE_MAX) {
    const oldest = embedCache.keys().next().value
    if (oldest !== undefined) embedCache.delete(oldest)
  }
  embedCache.set(key, vector)
}

/**
 * embed() with a bounded in-process cache, embedding only what it hasn't seen.
 *
 * Worth having because the same paper recurs constantly: across the claims of
 * one document, across re-analyses as a student edits, and across the four
 * providers that each return overlapping results for related queries.
 */
export async function embedCached(texts: string[]): Promise<Float32Array[] | null> {
  const keys = texts.map(cacheKey)
  const missingIndices: number[] = []
  const seen = new Set<string>()
  for (let i = 0; i < keys.length; i++) {
    // Guard against duplicates within one batch as well as across calls —
    // otherwise the same text present twice is embedded twice.
    if (!embedCache.has(keys[i]) && !seen.has(keys[i])) {
      seen.add(keys[i])
      missingIndices.push(i)
    }
  }

  if (missingIndices.length > 0) {
    const fresh = await embed(missingIndices.map((i) => texts[i]))
    if (!fresh) return null
    missingIndices.forEach((_, j) => remember(keys[missingIndices[j]], fresh[j]))
  }

  const result: Float32Array[] = []
  for (const key of keys) {
    const vector = embedCache.get(key)
    if (!vector) return null
    result.push(vector)
  }
  return result
}

// Asserting "your claim is contradicted by the literature" is the highest-cost
// output this app can produce — a wrong one is worse for a student than saying
// nothing. So the bar for contradicts is deliberately higher than for supports.
//
// Measured on twelve hand-written pairs, the model's one dangerous error was a
// 0.64-confidence contradicts on a topically unrelated paper. The relevance
// gate in the caller catches that case, and this threshold is the second line.
export const MIN_CONTRADICTION_CONFIDENCE = 0.8
// Lower than the contradiction bar on purpose, and asymmetric for a reason:
// wrongly claiming support overstates a student's evidence, while wrongly
// claiming contradiction tells them a true sentence is false. The second is
// the one worth being timid about.
//
// 0.5 rather than 0.6 because 0.6 was measured to be too strict — the Ctrip
// remote-work paper, an unambiguous support, scores 0.59 and was being
// discarded as unclear. Over three classes, 0.5 is still well clear of the
// 0.33 chance line.
export const MIN_SUPPORT_CONFIDENCE = 0.5

/**
 * Asks, for each passage, whether it supports or contradicts the claim.
 *
 * Returns `null` rather than throwing when the model is unavailable, like
 * embed() — a claim with no stance verdict is displayed as unverified, not as
 * unsupported.
 *
 * The caller must only pass passages that already cleared the relevance bar.
 * An NLI model asked about an unrelated paper does not answer "irrelevant"; it
 * answers with whichever of entailment/contradiction/neutral fits best, and
 * that answer is noise. Relevance and stance are separate questions, in that
 * order.
 */
export async function classifyStance(claim: string, passages: string[]): Promise<StanceVerdict[] | null> {
  if (passages.length === 0) return []

  const active = ensureWorker()
  if (!active) return null

  const response = await send({ id: nextId++, op: 'stance', claim, passages }, active)

  if (!response.ok) {
    console.warn(`[ml] stance failed — ${response.error}`)
    return null
  }
  if (response.op !== 'stance' || response.verdicts.length !== passages.length) return null

  // Anything under the bar is reported as unclear rather than as its raw
  // label, so a low-confidence "contradicts" can never reach a student as one.
  return response.verdicts.map((verdict) => {
    if (verdict.stance === 'contradicts' && verdict.confidence < MIN_CONTRADICTION_CONFIDENCE) {
      return { stance: 'unclear' as const, confidence: verdict.confidence }
    }
    if (verdict.stance === 'supports' && verdict.confidence < MIN_SUPPORT_CONFIDENCE) {
      return { stance: 'unclear' as const, confidence: verdict.confidence }
    }
    return verdict
  })
}

export function isMlAvailable(): boolean {
  return !unavailable
}

export async function shutdownMl(): Promise<void> {
  const active = worker
  worker = null
  if (active) await active.terminate()
}
