import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dotenv from 'dotenv'

dotenv.config({ path: resolve(__dirname, '.env') })

// Baked into the compiled main-process bundle at build time. There is no
// runtime/user-editable path to these values — only whoever runs
// `npm run dist:win` with a given .env controls which relay the app talks to.
const RELAY_URL = JSON.stringify(process.env.RELAY_URL ?? '')
const RELAY_TOKEN = JSON.stringify(process.env.RELAY_TOKEN ?? '')
const SUPABASE_URL = JSON.stringify(process.env.SUPABASE_URL ?? '')
const SUPABASE_ANON_KEY = JSON.stringify(process.env.SUPABASE_ANON_KEY ?? '')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __RELAY_URL__: RELAY_URL,
      __RELAY_TOKEN__: RELAY_TOKEN,
      __SUPABASE_URL__: SUPABASE_URL,
      __SUPABASE_ANON_KEY__: SUPABASE_ANON_KEY
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Second entry rather than a chunk of the main bundle: worker_threads
          // needs a real file on disk to spawn, and services/ml/index.ts
          // resolves it as mlWorker.js beside the main bundle.
          mlWorker: resolve(__dirname, 'src/main/services/ml/worker.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    // Tailwind is scoped to the Tracer window by import, not by config: only
    // `src/renderer/src/styles/tracer.css` pulls it in, and only tracer.tsx
    // imports that file. The other three entries (index/floating/overlay)
    // stay on the inline-style + styles/index.css idiom they already use, so
    // Tailwind's preflight reset can't reach them.
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // shadcn's registry emits `@/components/ui/...` imports verbatim, so
        // `@` has to resolve to the renderer source root for pasted
        // components to work without hand-editing every import.
        '@': resolve(__dirname, 'src/renderer/src'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          floating: resolve(__dirname, 'src/renderer/floating.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          tracer: resolve(__dirname, 'src/renderer/tracer.html')
        }
      }
    }
  }
})
