// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// scripts/env.mjs
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
var __electron_vite_injected_import_meta_url = "file:///C:/Users/merri/Tracely-agent1/scripts/env.mjs";
var REPO_ROOT = join(dirname(fileURLToPath(__electron_vite_injected_import_meta_url)), "..");
var ENV_NAME = process.env.TRACELY_ENV === "staging" ? "staging" : "production";
var ENV_FILE = ENV_NAME === "staging" ? ".env.staging" : ".env";
var hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};
var refOf = (url) => hostOf(url).split(".")[0] ?? "";
function loadEnv({ root = REPO_ROOT, quiet = false } = {}) {
  const file = join(root, ENV_FILE);
  if (!existsSync(file)) {
    console.error(`
${ENV_FILE} not found at ${file}`);
    if (ENV_NAME === "staging") {
      console.error("Staging was requested explicitly, so falling back to .env would");
      console.error('build a "staging" app pointed at production. Refusing.\n');
    }
    process.exit(1);
  }
  dotenv.config({ path: file, override: true });
  const info = {
    name: ENV_NAME,
    file: ENV_FILE,
    relayHost: hostOf(process.env.RELAY_URL ?? ""),
    supabaseRef: refOf(process.env.SUPABASE_URL ?? "")
  };
  if (!quiet) console.log(describeEnv(info));
  return info;
}
function describeEnv(info) {
  const relay = info.relayHost || "(no RELAY_URL)";
  const supabase = info.supabaseRef || "(no SUPABASE_URL)";
  return `  env=${info.name}  file=${info.file}  relay=${relay}  supabase=${supabase}`;
}
function relayDefines() {
  return {
    __RELAY_URL__: JSON.stringify(process.env.RELAY_URL ?? ""),
    __RELAY_TOKEN__: JSON.stringify(process.env.RELAY_TOKEN ?? ""),
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? ""),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY ?? "")
  };
}

// electron.vite.config.ts
var __electron_vite_injected_dirname = "C:\\Users\\merri\\Tracely-agent1";
loadEnv();
var { __RELAY_URL__, __RELAY_TOKEN__, __SUPABASE_URL__, __SUPABASE_ANON_KEY__ } = relayDefines();
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __RELAY_URL__,
      __RELAY_TOKEN__,
      __SUPABASE_URL__,
      __SUPABASE_ANON_KEY__
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/main/index.ts"),
          // Second entry rather than a chunk of the main bundle: worker_threads
          // needs a real file on disk to spawn, and services/ml/index.ts
          // resolves it as mlWorker.js beside the main bundle.
          mlWorker: resolve(__electron_vite_injected_dirname, "src/main/services/ml/worker.ts")
        }
      }
    },
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts") }
      }
    },
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
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
        "@": resolve(__electron_vite_injected_dirname, "src/renderer/src"),
        "@renderer": resolve(__electron_vite_injected_dirname, "src/renderer/src"),
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/renderer/index.html"),
          floating: resolve(__electron_vite_injected_dirname, "src/renderer/floating.html"),
          overlay: resolve(__electron_vite_injected_dirname, "src/renderer/overlay.html"),
          tracer: resolve(__electron_vite_injected_dirname, "src/renderer/tracer.html")
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
