// Every filesystem location the main process writes to resolves through
// here instead of calling Electron's `app.getPath`/`app.getAppPath`
// directly. The point is that `storage/` and `search/` stop transitively
// importing `electron` at module load: before this, importing
// `search/openalex.ts` pulled in settingsRepo -> db.ts -> `electron`, so
// nothing in the evidence pipeline could run outside a booted app — which
// is why there was no way to measure retrieval or scoring quality offline.
// `scripts/evaluate.mjs` now calls setAppPaths() with a scratch dir and
// imports the real pipeline.
//
// Injection rather than a lazy `require('electron')` because getDataDir()
// has to be synchronous (db.ts uses it during init) and a conditional
// require of a native module is the kind of thing that works in dev and
// breaks in the packaged build.

export interface AppPaths {
  /** Per-user writable dir — SQLite database, config.json. */
  dataDir: string
  /** App/repo root, for reading bundled files (.env, sql.js's wasm in dev). */
  appRoot: string
  /** Electron's process.resourcesPath when packaged; null in dev and in scripts. */
  resourcesDir: string | null
}

let paths: AppPaths | null = null

export function setAppPaths(next: AppPaths): void {
  paths = next
}

export function getAppPaths(): AppPaths {
  if (!paths) {
    throw new Error(
      'App paths not configured — call setAppPaths() before touching storage (main/index.ts does this at startup)'
    )
  }
  return paths
}
