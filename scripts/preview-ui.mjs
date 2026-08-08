// `npm run preview` — boots the Tracely preview harness as a desktop app.
//
// Starts a Vite dev server for the renderer (with the mock-IPC bridge
// injected, see preview/vite.config.mts) and launches Electron against it.
// HMR is live: edit any real component and the previewed surface updates
// without a restart.
//
// This never touches out/, never runs the real main process, and never
// opens the SQLite database — you can leave it running while the actual app
// is running too.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createServer } from 'vite'
import electron from 'electron'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const server = await createServer({
  configFile: resolve(repo, 'preview/vite.config.mts')
})
await server.listen()

const port = server.config.server.port
const url = `http://localhost:${port}/preview.html`
console.log(`\n  Tracely Preview  →  ${url}\n`)

const child = spawn(electron, [resolve(repo, 'preview/main.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, TRACELY_PREVIEW_URL: url }
})

// Closing the window should take the dev server with it, and Ctrl+C should
// take both — otherwise the strictPort:true server leaks and the next
// `npm run preview` fails with EADDRINUSE.
const shutdown = async (code = 0) => {
  await server.close().catch(() => {})
  process.exit(code)
}
child.on('close', (code) => void shutdown(code ?? 0))
process.on('SIGINT', () => {
  child.kill()
  void shutdown(0)
})
