#!/usr/bin/env node
// Runs src/main/eval/timing.ts, the same way scripts/evaluate.mjs runs the
// harness: one esbuild pass with the @shared alias and the relay defines, then
// node executes the bundle.
//
// Costs nothing. It makes no relay calls at all — no detection, no critique —
// and the providers it touches are free (Crossref, PubMed, Wikipedia) or
// answer 429 for nothing (OpenAlex, Semantic Scholar).

import { mkdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import dotenv from 'dotenv'
import * as esbuild from 'esbuild'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(repoRoot, '.env') })

const bundlePath = join(repoRoot, 'out', 'eval', 'timing.mjs')
const workerPath = join(repoRoot, 'out', 'eval', 'mlWorker.cjs')
mkdirSync(dirname(bundlePath), { recursive: true })

await esbuild.build({
  entryPoints: [join(repoRoot, 'src', 'main', 'eval', 'timing.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: bundlePath,
  alias: { '@shared': join(repoRoot, 'src', 'shared') },
  external: ['sql.js', 'dotenv'],
  banner: {
    js: "import{createRequire as __cr}from'module';import{fileURLToPath as __f}from'url';import{dirname as __d}from'path';const require=__cr(import.meta.url);const __filename=__f(import.meta.url);const __dirname=__d(__filename);"
  },
  define: {
    __RELAY_URL__: JSON.stringify(process.env.RELAY_URL ?? ''),
    __RELAY_TOKEN__: JSON.stringify(process.env.RELAY_TOKEN ?? ''),
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY ?? '')
  }
})

await esbuild.build({
  entryPoints: [join(repoRoot, 'src', 'main', 'services', 'ml', 'worker.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: workerPath,
  external: ['@huggingface/transformers']
})

process.env.TRACELY_ML_WORKER = workerPath
process.env.EVAL_REPO_ROOT = repoRoot

const { main } = await import(pathToFileURL(bundlePath).href)
await main()
process.exit(0)
