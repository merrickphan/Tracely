import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'

dotenv.config({ path: resolve(__dirname, '.env') })

// Baked into the compiled main-process bundle at build time. There is no
// runtime/user-editable path to these values — only whoever runs
// `npm run dist:win` with a given .env controls which relay the app talks to.
const RELAY_URL = JSON.stringify(process.env.RELAY_URL ?? '')
const RELAY_TOKEN = JSON.stringify(process.env.RELAY_TOKEN ?? '')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __RELAY_URL__: RELAY_URL,
      __RELAY_TOKEN__: RELAY_TOKEN
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
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
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          floating: resolve(__dirname, 'src/renderer/floating.html')
        }
      }
    }
  }
})
