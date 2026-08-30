# Building Tracely installers

`npm run dist:win` and `npm run dist:mac` each produce an installer in
`release/`. Both run `fetch-models` → `electron-vite build` →
`electron-builder`, and `afterPack` gates every build on
`verify-packaged-ml.mjs` (ML closure unpacked, weights + the target platform's
native binary present, exactly one relay host, and — on a native build — a real
offline embedding).

## Native build (the normal case)

On the target OS, just run the script for that OS:

```bash
npm run dist:win     # on Windows  → release/Tracely Setup <ver>.exe   (x64)
npm run dist:mac     # on macOS    → release/Tracely-<ver>-arm64.dmg
```

A native `npm install` only fetches the current platform's optional binaries
(sharp), and `onnxruntime-node` ships every platform's binary in one package —
so nothing foreign is present to leak into the asar, and the guard's offline
embed test runs for real.

## Cross-building both installers from one machine

To build the *other* platform's installer you must (a) provide that platform's
native binaries and (b) remove this platform's, or the guard fails the build —
correctly — on a foreign onnxruntime binding. The build is unsigned
(`CSC_IDENTITY_AUTO_DISCOVERY=false`).

**Windows installer from macOS** (x64, matching the released arch):

```bash
npm ci                                                        # pristine, hoisted layout
npm i --no-save --force @img/sharp-win32-x64 @img/sharp-libvips-win32-x64
rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin \
       node_modules/@img/sharp-darwin-arm64 node_modules/@img/sharp-libvips-darwin-arm64
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64
```

**macOS dmg from an Apple-Silicon mac** (arm64):

```bash
npm ci
rm -rf node_modules/onnxruntime-node/bin/napi-v6/win32 \
       node_modules/@img/sharp-win32-x64 node_modules/@img/sharp-libvips-win32-x64
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64
```

The offline embed test is skipped with a loud `SKIP` line when host ≠ target (a
win32 `.node` cannot execute on darwin); exercise it with a native build of the
same commit. Intel-mac (`--mac --x64`) needs the `darwin-x64` onnxruntime and
sharp binaries, which an arm64 machine does not install by default.

## macOS installers are built in CI, not by hand

`.github/workflows/mac-installers.yml` builds both Mac arches and attaches them
to a release. It runs automatically when a release is published, and can be run
manually against an existing tag from the Actions tab.

This exists for two reasons. Intel (`--mac --x64`) cannot be produced on an
Apple-Silicon machine without the darwin-x64 onnxruntime and sharp binaries, so
in practice it was never built and Intel users had no download. And the dmg was
otherwise hand-carried into each release, so it was routinely missing while the
website's Mac button pointed at it.

The job needs the production compile-time values as repository secrets:

    RELEASE_RELAY_URL
    RELEASE_RELAY_TOKEN
    RELEASE_SUPABASE_URL
    RELEASE_SUPABASE_ANON_KEY

There is no fallback to the staging secrets. A build labelled "release" that
quietly pointed at staging is the failure `scripts/env.mjs` already refuses, so
the workflow stops with an explicit error instead. Both dmgs are unsigned —
signing needs a paid Developer ID, and `CSC_IDENTITY_AUTO_DISCOVERY=false` keeps
the runner from trying.

## Why `electron-builder.yml` has one top-level `files:` and no platform block

A platform-scoped `files:` containing only negations makes electron-builder
reset the base list to `**/*`, silently dropping every top-level exclude —
which shipped the dev docs and `.env` into the asar. The per-platform binary
split is therefore done by the `npm`/`rm` steps above, not by config.
