// Proves the packaged build can actually run embeddings offline.
//
// This check exists because the failure it guards against is invisible. When
// the ML stack was excluded from the installer, services/ml/index.ts degraded
// to lexical scoring exactly as designed: no error, no crash, no log a user
// would see — the packaged app just quietly ran the old word-overlap path
// while every measurement in eval/ described the new one. A build can be
// "successful" and ship none of this.
//
// So: load the worker bundle that electron-vite actually emitted, point it at
// the weights electron-builder actually copied, forbid network access, and
// require a real vector back.

import { createRequire } from 'module'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Worker } from 'worker_threads'
import { loadEnv } from './env.mjs'

// afterPack spawns this as a bare node process, so nothing has read .env yet.
// Loading it here is what lets the relay-host check below know which relay this
// build is supposed to be talking to — and env.mjs picks .env.staging on its own
// when TRACELY_ENV says so, so a preview build is checked against staging.
loadEnv({ quiet: true })

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = join(REPO, 'out', 'main', 'mlWorker.js')
// electron-builder's afterPack hook passes the app it just packed, which is
// what makes this a gate rather than a report: it runs before the installer is
// built and before anything is published. Defaults to the standard Windows
// output so it can also be run by hand against an existing build.
const RESOURCES = process.argv[2] ?? join(REPO, 'release', 'win-unpacked', 'resources')
const MODELS = join(RESOURCES, 'models')
const ASAR = join(RESOURCES, 'app.asar')

function fail(message) {
  console.error(`FAIL  ${message}`)
  process.exit(1)
}

if (!existsSync(WORKER)) fail(`no worker bundle at ${WORKER} — run \`npm run build\` first`)
if (!existsSync(MODELS)) fail(`no bundled models at ${MODELS} — run \`npm run dist:win\` first`)
if (!existsSync(ASAR)) fail(`no app.asar at ${ASAR} — run \`npm run dist:win\` first`)

// Check the archive as well as the weights. The embedding test below resolves
// @huggingface/transformers from the repo's own node_modules, so it would pass
// happily for an installer that shipped none of it — which is exactly the bug
// being guarded against. These assertions read what electron-builder actually
// wrote.
const asar = createRequire(import.meta.url)('@electron/asar')
const packed = asar.listPackage(ASAR).map((path) => path.replace(/\\/g, '/'))
const count = (fragment) => packed.filter((path) => path.includes(fragment)).length

// [fragment, must be present?, why it matters]
const EXPECTATIONS = [
  ['@huggingface/transformers/dist', true, 'the library itself'],
  ['@huggingface/jinja', true, 'transitive dependency of transformers'],
  ['onnxruntime-node/bin/napi-v6/win32/x64', true, 'the inference runtime for this target'],
  ['@img/sharp-win32-x64', true, 'transformers.node.mjs imports sharp at the top level'],
  ['@huggingface/transformers/.cache', false, '202MB of dev-downloaded weights'],
  ['@huggingface/transformers/src', false, 'TypeScript sources; dist is what runs'],
  ['onnxruntime-node/bin/napi-v6/win32/arm64', false, 'wrong architecture'],
  ['onnxruntime-node/bin/napi-v6/darwin', false, 'wrong platform'],
  ['onnxruntime-node/bin/napi-v6/linux', false, 'wrong platform'],
  ['onnxruntime-web', false, '128MB of browser WASM the node entry never imports'],
  ['out/eval', false, '114MB of eval harness — dev tooling the app never loads']
]

// The worker must exist as a REAL FILE, not just as an entry in the archive.
// worker_threads reads its entry script in native code that bypasses
// Electron's asar-aware fs patches, so a worker inside app.asar can fail to
// start in the packaged build alone — and when it does, services/ml disables
// itself and retrieval degrades silently to lexical scoring.
const unpackedWorker = join(RESOURCES, 'app.asar.unpacked', 'out', 'main', 'mlWorker.js')
if (!existsSync(unpackedWorker)) {
  fail(`ML worker is not unpacked at ${unpackedWorker} — add out/main/mlWorker.js to asarUnpack`)
}

let bad = 0
for (const [fragment, wanted, why] of EXPECTATIONS) {
  const found = count(fragment)
  const ok = wanted ? found > 0 : found === 0
  if (!ok) {
    bad++
    console.error(
      wanted
        ? `FAIL  ${fragment} is MISSING from app.asar — ${why}`
        : `FAIL  ${fragment} is in app.asar (${found} files) — ${why}`
    )
  }
}
if (bad > 0) fail(`${bad} packaging expectation(s) not met`)
console.log(`PASS  app.asar contents — ${EXPECTATIONS.length} packaging expectations met`)

// One relay per installer, and it must be this build's relay.
//
// The environment split is enforced at build time by inlining RELAY_URL into
// the bundle, so a build that also carries some *other* relay's host has broken
// the guarantee. That happened: out/ is not cleaned between environment
// switches, so a staging preview shipped out/eval bundles still pointing at
// folio-relay with the production shared token.
//
// It went unnoticed because the check we were running grepped out/main/index.js
// alone. This one reads the whole archive, which is the only version of the
// question that means anything — the leak was never in the file being checked.
const expectedRelay = (() => {
  try {
    return new URL(process.env.RELAY_URL ?? '').host.toLowerCase()
  } catch {
    return ''
  }
})()
if (!expectedRelay) fail('RELAY_URL is unset or unparseable — cannot tell which relay this build should use')

const archive = readFileSync(ASAR).toString('latin1')
// Deliberately narrow: any *.vercel.app host with "relay" in the name. Broad
// enough to catch both projects, narrow enough that an unrelated dependency
// mentioning vercel.app cannot turn a release red for nothing.
const relayHosts = [...new Set((archive.match(/[a-z0-9-]*relay[a-z0-9.-]*\.vercel\.app/gi) ?? []).map((h) => h.toLowerCase()))]
const foreign = relayHosts.filter((host) => host !== expectedRelay)
if (foreign.length > 0) {
  fail(
    `app.asar carries ${foreign.length} foreign relay host(s): ${foreign.join(', ')}\n` +
      `      This build targets ${expectedRelay}. Something stale is being packaged —\n` +
      `      try deleting out/ and rebuilding, then check the files globs.`
  )
}
if (!archive.includes(expectedRelay)) {
  fail(`app.asar does not contain ${expectedRelay} at all — the define block did not take`)
}
console.log(`PASS  one relay in app.asar — ${expectedRelay}`)

// allowRemote:false is the whole point. It mirrors what index.ts sets when it
// finds a bundled models dir, and it means a missing weight file fails here
// rather than being silently downloaded on a developer machine that has
// network — which would make this check pass for a build that strands every
// real user.
const worker = new Worker(WORKER, {
  workerData: { cacheDir: join(RESOURCES, 'unused-cache'), localModelPath: MODELS, allowRemote: false }
})

const timer = setTimeout(() => fail('timed out after 120s loading the bundled model'), 120_000)

worker.on('error', (error) => fail(`worker crashed — ${error.message}`))

worker.on('message', (response) => {
  clearTimeout(timer)

  if (!response.ok) fail(`worker returned an error — ${response.error}`)
  if (response.dim !== 384) fail(`expected 384 dimensions, got ${response.dim}`)
  if (response.data.length !== 2 * 384) fail(`expected 2 vectors, got ${response.data.length / response.dim}`)

  const a = response.data.subarray(0, 384)
  const b = response.data.subarray(384, 768)
  const dot = (x, y) => x.reduce((sum, value, i) => sum + value * y[i], 0)

  // A model that loaded but produced garbage would still return the right
  // shape, so check the vectors mean something: these two sentences are about
  // the same thing and must land far closer than chance.
  const similarity = dot(a, b)
  if (!Number.isFinite(similarity)) fail('embedding contains non-finite values')
  if (similarity < 0.4) fail(`related sentences scored ${similarity.toFixed(3)} — model loaded but output is wrong`)

  console.log(`PASS  bundled model embeds offline — 384 dims, related sentences at ${similarity.toFixed(3)}`)
  worker.terminate()
})

worker.postMessage({
  id: 1,
  op: 'embed',
  texts: [
    'Students who start school later get more sleep.',
    'Delaying school start times increases adolescent sleep duration.'
  ]
})
