// Types for env.mjs, which electron.vite.config.ts imports.
//
// The resolver stays plain JavaScript because the node scripts that use it
// (preflight, evaluate, timing, ship) run directly through node with no build
// step. This file is what lets the one TypeScript consumer import it without
// `any`.

export declare const REPO_ROOT: string
export declare const ENV_NAME: 'production' | 'staging'
export declare const ENV_FILE: string

export interface EnvInfo {
  name: 'production' | 'staging'
  file: string
  /** Host of RELAY_URL, e.g. folio-relay.vercel.app. Empty when unset. */
  relayHost: string
  /** Supabase project ref — the first label of the project host. */
  supabaseRef: string
}

export declare function loadEnv(options?: { root?: string; quiet?: boolean }): EnvInfo

export declare function describeEnv(info: EnvInfo): string

/** The four compile-time constants, already JSON.stringify'd for esbuild. */
export declare function relayDefines(): {
  __RELAY_URL__: string
  __RELAY_TOKEN__: string
  __SUPABASE_URL__: string
  __SUPABASE_ANON_KEY__: string
}

/** Cassette directory for the active environment, under the given out dir. */
export declare function cassetteDir(outDir: string): string
