import { parentPort, workerData } from 'worker_threads'
import { EMBED_MODEL_ID, type MlRequest, type MlResponse, type MlWorkerData } from './protocol'

// Runs in its own thread for the same reason sql.js's cost is a known problem
// rather than a hypothetical one: the main process already serialises the
// whole database on every write, and inference is a CPU-bound loop measured in
// tens of milliseconds per call. Adding that to the main thread would stall
// IPC, the tray, and every window for the duration.
//
// The thread carries no Electron imports and no database handle. It takes text
// and returns numbers; anything worth keeping is persisted by the caller.

const { cacheDir, localModelPath, allowRemote } = workerData as MlWorkerData

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Extractor = (texts: string[], options: Record<string, unknown>) => Promise<any>

let extractorPromise: Promise<Extractor> | null = null

// @huggingface/transformers is ESM-only and this bundle is CJS, so it can only
// be reached through a dynamic import. Deliberately lazy on top of that: the
// worker starts at app boot but the ~200MB of weights and runtime should not
// load until something actually asks for an embedding.
async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')

      env.cacheDir = cacheDir
      env.allowRemoteModels = allowRemote
      if (localModelPath) {
        env.localModelPath = localModelPath
      }

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

async function embed(texts: string[]): Promise<{ data: Float32Array; dim: number }> {
  const extractor = await getExtractor()
  // Normalised at the source so callers can use a plain dot product for
  // cosine similarity and can't accidentally compare unnormalised vectors.
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  const dim = output.dims[output.dims.length - 1] as number
  return { data: new Float32Array(output.data), dim }
}

parentPort?.on('message', async (request: MlRequest) => {
  let response: MlResponse
  try {
    const { data, dim } = await embed(request.texts)
    response = { id: request.id, ok: true, data, dim }
  } catch (error) {
    // A failure here must stay a failure of *this request*. The host degrades
    // to lexical scoring rather than failing the search, so the worker stays
    // alive and the next call gets a fresh attempt.
    response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  if (response.ok) {
    // Always a fresh ArrayBuffer — `new Float32Array(...)` above allocates one
    // — but the typed-array signature admits SharedArrayBuffer, which is not
    // transferable.
    parentPort?.postMessage(response, [response.data.buffer as ArrayBuffer])
  } else {
    parentPort?.postMessage(response)
  }
})
