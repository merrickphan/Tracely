import { parentPort, workerData } from 'worker_threads'
import {
  EMBED_MODEL_ID,
  STANCE_MODEL_ID,
  type MlRequest,
  type MlResponse,
  type MlWorkerData,
  type Stance,
  type StanceVerdict
} from './protocol'

// Runs in its own thread for the same reason sql.js's cost is a known problem
// rather than a hypothetical one: the main process already serialises the
// whole database on every write, and inference is a CPU-bound loop measured in
// tens of milliseconds per call. Adding that to the main thread would stall
// IPC, the tray, and every window for the duration.
//
// The thread carries no Electron imports and no database handle. It takes text
// and returns numbers; anything worth keeping is persisted by the caller.

const { cacheDir, localModelPath, allowRemote } = workerData as MlWorkerData

/* eslint-disable @typescript-eslint/no-explicit-any */
type Extractor = (texts: string[], options: Record<string, unknown>) => Promise<any>

let transformers: any = null
let extractorPromise: Promise<Extractor> | null = null
let stancePromise: Promise<{ tokenizer: any; model: any; labels: Record<string, string> }> | null = null

// @huggingface/transformers is ESM-only and this bundle is CJS, so it can only
// be reached through a dynamic import. Deliberately lazy on top of that: the
// worker starts at app boot but the weights and runtime should not load until
// something actually asks for them. The two models load independently — a
// document with no contradicted claims never pays for the NLI weights.
async function lib(): Promise<any> {
  if (!transformers) {
    transformers = await import('@huggingface/transformers')
    transformers.env.cacheDir = cacheDir
    transformers.env.allowRemoteModels = allowRemote
    if (localModelPath) transformers.env.localModelPath = localModelPath
  }
  return transformers
}

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await lib()
      // 'cpu' is onnxruntime-node. Its prebuilt binaries ship as napi-v6, and
      // N-API is ABI-stable across Node and Electron, so this needs no rebuild
      // — verified running under Electron 32.3.3. There is no 'wasm' device on
      // the Node entry point; the options are dml, webgpu and cpu.
      return (await pipeline('feature-extraction', EMBED_MODEL_ID, {
        device: 'cpu',
        dtype: 'q8'
      })) as unknown as Extractor
    })()
  }
  return extractorPromise
}

async function getStanceModel(): Promise<{ tokenizer: any; model: any; labels: Record<string, string> }> {
  if (!stancePromise) {
    stancePromise = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification } = await lib()
      const tokenizer = await AutoTokenizer.from_pretrained(STANCE_MODEL_ID)
      const model = await AutoModelForSequenceClassification.from_pretrained(STANCE_MODEL_ID, {
        device: 'cpu',
        dtype: 'q8'
      })
      // Read from the model rather than hardcoded: this checkpoint orders the
      // classes contradiction/entailment/neutral, which is NOT the MNLI
      // convention, and a swapped mapping would invert every verdict silently.
      return { tokenizer, model, labels: model.config.id2label }
    })()
  }
  return stancePromise
}

async function embed(texts: string[]): Promise<{ data: Float32Array; dim: number }> {
  const extractor = await getExtractor()
  // Normalised at the source so callers can use a plain dot product for
  // cosine similarity and can't accidentally compare unnormalised vectors.
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  const dim = output.dims[output.dims.length - 1] as number
  return { data: new Float32Array(output.data), dim }
}

function toStance(rawLabel: string): Stance {
  const label = rawLabel.toLowerCase()
  if (label.startsWith('entail')) return 'supports'
  if (label.startsWith('contradict')) return 'contradicts'
  return 'unclear'
}

async function classifyStance(claim: string, passages: string[]): Promise<StanceVerdict[]> {
  const { tokenizer, model, labels } = await getStanceModel()

  // NLI direction matters and is easy to get backwards: the PREMISE is the
  // published finding and the HYPOTHESIS is the student's claim. Asking
  // "does this paper entail what the student wrote" is the question; the
  // reverse asks whether a one-sentence claim entails a whole abstract, which
  // is almost never true and would collapse everything to neutral.
  const inputs = await tokenizer(passages, {
    text_pair: passages.map(() => claim),
    padding: true,
    truncation: true
  })
  const { logits } = await model(inputs)

  const [rows, classes] = logits.dims as [number, number]
  const verdicts: StanceVerdict[] = []

  for (let i = 0; i < rows; i++) {
    const row = Array.from(logits.data.slice(i * classes, (i + 1) * classes)) as number[]
    const max = Math.max(...row)
    const exponentials = row.map((value) => Math.exp(value - max))
    const total = exponentials.reduce((a, b) => a + b, 0)
    const probabilities = exponentials.map((value) => value / total)
    const best = probabilities.indexOf(Math.max(...probabilities))
    verdicts.push({ stance: toStance(String(labels[best])), confidence: probabilities[best] })
  }

  return verdicts
}

parentPort?.on('message', async (request: MlRequest) => {
  let response: MlResponse
  try {
    if (request.op === 'embed') {
      const { data, dim } = await embed(request.texts)
      response = { id: request.id, op: 'embed', ok: true, data, dim }
    } else {
      const verdicts = await classifyStance(request.claim, request.passages)
      response = { id: request.id, op: 'stance', ok: true, verdicts }
    }
  } catch (error) {
    // A failure here must stay a failure of *this request*. The host degrades
    // rather than failing the search, so the worker stays alive and the next
    // call gets a fresh attempt.
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  if (response.ok && response.op === 'embed') {
    // Always a fresh ArrayBuffer — `new Float32Array(...)` above allocates one
    // — but the typed-array signature admits SharedArrayBuffer, which is not
    // transferable.
    parentPort?.postMessage(response, [response.data.buffer as ArrayBuffer])
  } else {
    parentPort?.postMessage(response)
  }
})
