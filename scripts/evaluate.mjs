#!/usr/bin/env node
// Runs src/main/eval/harness.ts on plain node.
//
// The harness can't be executed directly for three reasons, all of which
// this script handles: it's TypeScript, it imports through the `@shared`
// alias, and services/ai/client.ts reads __RELAY_URL__/__RELAY_TOKEN__ which
// only exist because electron.vite.config.ts inlines them at build time. So
// esbuild does one bundle pass with the same alias and the same defines, and
// node runs the result.
//
// Output lands in out/eval/ (gitignored) so node can still resolve sql.js
// and dotenv from the repo's node_modules.
//
// Usage:
//   npm run evaluate                      # uses eval/essays/
//   npm run evaluate -- --essays path     # a different folder
//   EVAL_SKIP_CRITIQUE=1 npm run evaluate # retrieval + scoring only, no relay critique calls

import { existsSync, mkdirSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import dotenv from 'dotenv'
import * as esbuild from 'esbuild'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: join(repoRoot, '.env') })

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index !== -1 ? process.argv[index + 1] : undefined
}

const essayArg = argValue('--essays') ?? 'eval/essays'
const essayDir = isAbsolute(essayArg) ? essayArg : join(repoRoot, essayArg)
const outDir = join(repoRoot, 'eval', 'reports')
const dataDir = join(repoRoot, 'out', 'eval', 'data')
const bundlePath = join(repoRoot, 'out', 'eval', 'harness.mjs')

if (!existsSync(essayDir)) {
  console.error(`No essay folder at ${essayDir}`)
  console.error('Create it and drop in .txt/.md files, or pass --essays <dir>.')
  process.exit(1)
}

// Every run of this script bills the OpenAI account behind the relay: one
// detect-claims call per essay plus one critique per claim, and the cache
// does not save you across a cache-key bump. Five runs in one afternoon is
// a visible line on the bill, which is exactly how this guard came to
// exist. Spending is now opt-in per invocation rather than the default.
if (!process.env.EVAL_ALLOW_SPEND) {
  console.error('Refusing to run: this harness makes paid relay calls.')
  console.error('')
  console.error('  Retrieval and scoring only (free — academic APIs, no relay):')
  console.error('    EVAL_ALLOW_SPEND=1 EVAL_SKIP_CRITIQUE=1 npm run evaluate')
  console.error('')
  console.error('  Full run including detection and critique (paid):')
  console.error('    EVAL_ALLOW_SPEND=1 npm run evaluate')
  console.error('')
  console.error('Rebuilding the preview from an existing report costs nothing: npm run preview')
  process.exit(1)
}

if (!process.env.RELAY_URL) {
  console.error('RELAY_URL is not set in .env — claim detection cannot run.')
  console.error('(If you disabled it deliberately, restore it from .env.backup-before-killswitch.)')
  process.exit(1)
}

mkdirSync(dirname(bundlePath), { recursive: true })

// The JS API rather than the CLI: define values are JSON strings, and on
// Windows spawning through a .cmd shim strips their quotes before esbuild
// ever sees them ("Invalid define value").
await esbuild.build({
  entryPoints: [join(repoRoot, 'src', 'main', 'eval', 'harness.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: bundlePath,
  alias: { '@shared': join(repoRoot, 'src', 'shared') },
  // Left external so node loads them from node_modules at runtime —
  // sql.js in particular ships a wasm sidecar that a bundler would break.
  external: ['sql.js', 'dotenv'],
  define: {
    __RELAY_URL__: JSON.stringify(process.env.RELAY_URL ?? ''),
    __RELAY_TOKEN__: JSON.stringify(process.env.RELAY_TOKEN ?? ''),
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY ?? '')
  }
})

process.env.EVAL_REPO_ROOT = repoRoot
process.env.EVAL_DATA_DIR = dataDir
process.env.EVAL_ESSAY_DIR = essayDir
process.env.EVAL_OUT_DIR = outDir

const { main } = await import(pathToFileURL(bundlePath).href)
await main()
