import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const repo = resolve(__dirname)
const renderer = resolve(repo, 'src/renderer')

// The real main-window entry, exactly as index.html references it.
const REAL_ENTRY = resolve(renderer, 'src/main.tsx')
const BOOTSTRAP = resolve(renderer, 'src/preview/bootstrap.ts')
const MOCK_API = resolve(renderer, 'src/preview/mockApi.ts')

// Rollup-convention virtual ids (\0 keeps other plugins' hands off them).
const PROXY_ID = '\0tracely-demo-entry'
const SHIM_ID = '\0tracely-demo-shim'

/**
 * The OFFLINE-demo variant of web.vite.config.mts's bridge injection.
 *
 * Same goal as preview/vite.config.mts — install the fixture-backed mock
 * `window.tracely` BEFORE the app's own entry module runs — but active during
 * `vite build` (no `apply: 'serve'`), and done by wrapping the entry module
 * rather than by injecting a second <script> tag into the HTML.
 *
 * Why not the tag-injection the other two configs use:
 *
 * 1. A second module-script entry produces a second Rollup entry chunk plus a
 *    shared chunk, and chunks reference each other by RELATIVE static imports
 *    — which cannot survive being inlined into a single self-contained HTML
 *    file. Keeping exactly ONE entry lets `inlineDynamicImports` force one
 *    chunk, which is the only shape scripts/make-demo.mjs can inline.
 * 2. bootstrap.ts reads the harness bridge from `window.parent.__tracelyPreview`
 *    and fails loudly when it is absent. Outside the harness iframe,
 *    `window.parent === window`, so the shim below installs a minimal bridge
 *    (the exported defaultScenario + a no-op log) on `window` first. The REAL
 *    bootstrap and the REAL mock then run unmodified, preserving the
 *    "window.tracely exists before the app entry" guarantee via plain ES
 *    module import order: shim -> bootstrap -> main.tsx.
 */
function injectMockBootstrap(): Plugin {
  return {
    name: 'tracely-demo-mock-bootstrap',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === PROXY_ID || source === SHIM_ID) return source
      // Redirect index.html's own entry reference — and only that one — to
      // the wrapper. The wrapper's import of the real file resolves with the
      // proxy as importer, so it does not loop.
      if (importer && importer.endsWith('index.html')) {
        const clean = source.split('?')[0]
        if (clean === '/src/main.tsx' || clean === REAL_ENTRY) return PROXY_ID
      }
      return undefined
    },
    load(id) {
      if (id === PROXY_ID) {
        return [
          `import ${JSON.stringify(SHIM_ID)}`,
          `import ${JSON.stringify(BOOTSTRAP)}`,
          `import ${JSON.stringify(REAL_ENTRY)}`,
          ''
        ].join('\n')
      }
      if (id === SHIM_ID) {
        return [
          `import { defaultScenario } from ${JSON.stringify(MOCK_API)}`,
          // bootstrap.ts looks on window.parent; standalone (not in an
          // iframe) that IS this window. Plain JS — virtual ids get no
          // TS transform.
          `window.__tracelyPreview = {`,
          `  scenario: defaultScenario,`,
          `  log: () => {}`,
          `}`,
          ''
        ].join('\n')
      }
      return undefined
    }
  }
}

export default defineConfig({
  // Must be src/renderer: the shipped HTML references its entry as
  // /src/main.tsx, which only resolves with the renderer as Vite's root.
  root: renderer,
  base: './',
  plugins: [injectMockBootstrap(), react()],
  resolve: {
    alias: {
      '@': resolve(repo, 'src/renderer/src'),
      '@renderer': resolve(repo, 'src/renderer/src'),
      '@shared': resolve(repo, 'src/shared')
    }
  },
  build: {
    outDir: resolve(repo, 'dist-demo'),
    emptyOutDir: true,
    // Only the main entry — the demo is one page, not the three windows.
    rollupOptions: {
      input: resolve(renderer, 'index.html'),
      // One chunk, so make-demo.mjs can inline it: an inlined module script
      // cannot resolve relative imports of sibling chunk files.
      output: { inlineDynamicImports: true, format: 'iife' }
    },
    // Inline every asset (fonts, images) as data: URIs directly in the JS/CSS,
    // so the final page needs no network and no sibling files.
    assetsInlineLimit: 100 * 1024 * 1024,
    // No sibling chunks exist to preload; the tags would just 404 offline.
    modulePreload: false
  },
  clearScreen: false
})
