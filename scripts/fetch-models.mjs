// Downloads the model weights that ship inside the installer.
//
// Runs before electron-builder (see the dist:win / release:win scripts). The
// download target is resources/models, which electron-builder copies to
// process.resourcesPath/models via extraResources, which is exactly where
// services/ml/index.ts looks for a bundled model.
//
// transformers.js's cache layout and its localModelPath layout are the same
// shape — <root>/<org>/<model>/... — so pointing env.cacheDir at the resources
// directory and loading the pipeline once puts every file in the right place
// without any copying or renaming.
//
// resources/models is gitignored: 22MB of binary weights don't belong in the
// repo, and this script reproduces them exactly from a pinned model id.

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODELS_DIR = join(REPO, 'resources', 'models')

// Kept in sync with EMBED_MODEL_ID in src/main/services/ml/protocol.ts. A
// mismatch is not silent: index.ts sets allowRemote=false whenever a bundled
// models dir exists, so a model that isn't here simply fails to load and the
// app degrades to lexical scoring — quietly, and only in the packaged build.
const MODELS = [{ id: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8', task: 'feature-extraction' }]

// Deliberately NOT the NLI stance model. Measured against the labelled
// baseline with real abstracts, it returned "unclear" for all 21 sources it
// was asked about, so its 83MB would buy nothing today. Its absence is a
// supported state: classifyStance returns null, computeStrengthScore uses
// WEIGHTS_WITHOUT_STANCE, and scores come out identical to a machine that
// cannot run the model at all. Add it here once it is fine-tuned.

function dirSize(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size
  }
  return total
}

mkdirSync(MODELS_DIR, { recursive: true })

const transformers = await import(
  pathToFileURL(join(REPO, 'node_modules/@huggingface/transformers/dist/transformers.node.mjs')).href
)

transformers.env.cacheDir = MODELS_DIR
transformers.env.allowRemoteModels = true

for (const model of MODELS) {
  const target = join(MODELS_DIR, ...model.id.split('/'))
  if (existsSync(target)) {
    console.log(`${model.id} — already present`)
    continue
  }
  console.log(`${model.id} — downloading (${model.dtype})…`)
  // Loading the pipeline is what triggers the fetch, and it also proves the
  // weights are usable rather than merely present.
  await transformers.pipeline(model.task, model.id, { device: 'cpu', dtype: model.dtype })
}

for (const model of MODELS) {
  const target = join(MODELS_DIR, ...model.id.split('/'))
  if (!existsSync(target)) {
    console.error(`\n${model.id} did not land in ${target} — refusing to build an installer without it.`)
    process.exit(1)
  }
}

console.log(`\nresources/models — ${(dirSize(MODELS_DIR) / 1024 / 1024).toFixed(1)} MB`)
