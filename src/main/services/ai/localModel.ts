// Runs claim detection (and, later, other essay-analysis tasks) on a
// bundled GGUF model in-process via node-llama-cpp — no external Ollama
// install/service, no relay call, no per-request cost. node-llama-cpp ships
// as an ESM-only package while this main-process bundle compiles to CJS, so
// it must be loaded with a dynamic import() rather than a static one.
import { getModelFilePath } from './modelDownload'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LlamaModule = any

let llamaModulePromise: Promise<LlamaModule> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionPromise: Promise<any> | null = null

function loadLlamaModule(): Promise<LlamaModule> {
  if (!llamaModulePromise) {
    llamaModulePromise = import('node-llama-cpp')
  }
  return llamaModulePromise
}

// Lazily loads the model + context on first use rather than at app boot, so
// a user who never enables the local model pays no startup cost for it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(): Promise<any> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { getLlama, LlamaChatSession } = await loadLlamaModule()
      const llama = await getLlama()
      const model = await llama.loadModel({ modelPath: getModelFilePath() })
      const context = await model.createContext()
      return new LlamaChatSession({ contextSequence: context.getSequence() })
    })().catch((err) => {
      // Don't cache a rejected promise — a transient failure (e.g. model
      // file briefly locked by an in-progress download) shouldn't
      // permanently wedge the local model for the rest of the app session.
      sessionPromise = null
      throw err
    })
  }
  return sessionPromise
}

/**
 * Task-agnostic local completion, constrained to a JSON schema — the local
 * equivalent of the relay's `response_format: json_schema`. Claim detection
 * is the first caller; future essay-analysis tasks (thesis, counterclaims,
 * structure scoring) call this same primitive with their own prompt/schema
 * rather than needing new model-loading code.
 */
export async function runLocalStructuredCompletion<T>(
  systemPrompt: string,
  userText: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jsonSchema: Record<string, any>
): Promise<T> {
  const [session, { getLlama }] = await Promise.all([getSession(), loadLlamaModule()])
  const llama = await getLlama()
  const grammar = await llama.createGrammarForJsonSchema(jsonSchema)

  // The session is a shared singleton (loading the model/context is the
  // expensive part) reused across unrelated task types — each with its own
  // system prompt — so history must be reset to exactly this call's system
  // prompt first, or a later task would see a prior task's conversation.
  session.setChatHistory([{ type: 'system', text: systemPrompt }])

  const response = await session.prompt(userText, {
    grammar,
    temperature: 0.2
  })

  return grammar.parse(response) as T
}
