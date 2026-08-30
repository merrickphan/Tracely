/* Build (or refresh) `extension-dev/` — a hot-reloading copy of `extension/`.
 *
 * The real extension stays pristine: no `tabs` permission, no reloader. This
 * generated copy is what you load unpacked in Chrome during a live session. The
 * live watcher (scripts/live.mjs) calls this with a fresh version string every
 * time it pulls new code, and the injected worker (ext-hot-reload.js) reloads
 * the extension when that string changes.
 *
 * Usage: node scripts/live-extension.mjs <version-string>
 */
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(REPO, 'extension')
const DEV = join(REPO, 'extension-dev')
const RELOADER = join(REPO, 'scripts', 'ext-hot-reload.js')

const version = process.argv[2] || String(Date.now())

if (!existsSync(SRC)) {
  console.error('[live-extension] no extension/ dir here — nothing to build')
  process.exit(1)
}

// Full re-copy each time. The extension is small, and copying is simpler and
// less bug-prone than diffing — Chrome only reads the tree on reload anyway.
rmSync(DEV, { recursive: true, force: true })
cpSync(SRC, DEV, { recursive: true })

// 1) Drop the reloader in beside the worker.
copyFileSync(RELOADER, join(DEV, 'hot-reload.js'))

// 2) Load it FIRST from the service worker. Classic (non-module) worker, so
//    importScripts is available and synchronous.
const bgPath = join(DEV, 'background.js')
if (existsSync(bgPath)) {
  const bg = readFileSync(bgPath, 'utf8')
  if (!bg.includes('hot-reload.js')) {
    writeFileSync(
      bgPath,
      "/* dev hot-reload — injected by scripts/live-extension.mjs, not in the real extension */\n" +
        "try { importScripts('hot-reload.js') } catch (e) { console.warn('hot-reload unavailable', e) }\n\n" +
        bg
    )
  }
}

// 3) Give the dev copy the permissions the reloader needs — `tabs` to refresh
//    pages after a reload, `alarms` to wake the worker if MV3 kills it. Neither
//    is ever added to the real manifest (that would change the store listing's
//    requested permissions).
const manifestPath = join(DEV, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.permissions = [...new Set([...(manifest.permissions || []), 'tabs', 'alarms'])]
manifest.name = (manifest.name || 'Tracely') + ' (Live)'
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

// 4) Stamp the version the reloader watches.
writeFileSync(join(DEV, 'DEV-VERSION'), version + '\n')

console.log(`[live-extension] extension-dev ready @ ${version}`)
