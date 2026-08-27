import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const repo = resolve(__dirname)

// The three real windows, exactly as electron.vite.config.ts builds them.
// preview.html is deliberately absent — the harness stays dev-only.
const ENTRY_NAMES = new Set(['index.html', 'floating.html', 'overlay.html'])

/**
 * Injects the HTTP-bridge bootstrap into each real entry.
 *
 * Same mechanism as preview/vite.config.mts's mock injection — `head-prepend`
 * + `type="module"`, so window.tracely is installed before the app's own
 * entry module — but WITHOUT `apply: 'serve'`: the web build ships against
 * the real local server, so the injection must survive `vite build` too.
 * No shipped HTML file changes; the injection exists only under this config.
 */
function injectHttpBridge(): Plugin {
  return {
    name: 'tracely-web-http-bridge',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        const name = ctx.path.split('?')[0].split('/').pop() ?? ''
        if (!ENTRY_NAMES.has(name)) return
        return [
          {
            tag: 'script',
            attrs: { type: 'module', src: '/src/bridge/bootstrap.ts' },
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
  base: '/',
  plugins: [react(), injectHttpBridge()],
  resolve: {
    alias: {
      '@': resolve(repo, 'src/renderer/src'),
      '@renderer': resolve(repo, 'src/renderer/src'),
      '@shared': resolve(repo, 'src/shared')
    }
  },
  build: {
    outDir: resolve(repo, 'dist-web'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(repo, 'src/renderer/index.html'),
        floating: resolve(repo, 'src/renderer/floating.html'),
        overlay: resolve(repo, 'src/renderer/overlay.html')
      }
    }
  },
  server: {
    port: 5200,
    strictPort: true,
    // The built dist-web is meant to be served BY the Tracely server itself
    // (same origin, so relative '/api/…' just works on any port). Dev serve
    // runs on this port instead, so proxy the API across — and strip the
    // Origin header, because the server's same-origin gate refuses foreign
    // browser origins and treats origin-less requests as curl-grade local.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4477',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
        }
      }
    }
  },
  clearScreen: false
})
