import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const repo = resolve(__dirname, '..')

// The four real windows. Each is served as its own document inside an iframe
// in the harness, so their stylesheets can't collide — Tracer ships Tailwind
// (preflight reset included) and the others don't.
const PREVIEWED_ENTRIES = ['/index.html', '/floating.html', '/overlay.html', '/tracer.html']

/**
 * Injects the mock-IPC bootstrap into each real entry, dev-server-side only.
 *
 * This is why the harness needs no changes to shipped code: the HTML on disk
 * is untouched, and this config is the only place the injection exists.
 * `head-prepend` + `type="module"` matters — module scripts run in document
 * order, so window.tracely is installed before the app's own entry module,
 * exactly as the preload contextBridge does it in production.
 */
function injectMockBridge(): Plugin {
  return {
    name: 'tracely-preview-mock-bridge',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        const path = ctx.path.split('?')[0]
        if (!PREVIEWED_ENTRIES.includes(path)) return
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: '/src/preview/bootstrap.ts' },
            injectTo: 'head-prepend' as const
          }
        ]
      }
    }
  }
}

export default defineConfig({
  // Must be src/renderer: the shipped HTML files reference their entries as
  // /src/<name>.tsx, which only resolves with the renderer as Vite's root.
  root: resolve(repo, 'src/renderer'),
  plugins: [react(), tailwindcss(), injectMockBridge()],
  resolve: {
    alias: {
      '@': resolve(repo, 'src/renderer/src'),
      '@renderer': resolve(repo, 'src/renderer/src'),
      '@shared': resolve(repo, 'src/shared')
    }
  },
  server: { port: 5199, strictPort: true },
  clearScreen: false
})
