// electron-builder afterPack hook.
//
// Runs once the app directory is packed and BEFORE the installer is built or
// anything is published, which is the only point where a packaging mistake can
// still be stopped rather than reported.
//
// It exists because of a specific failure that shipped: the ML stack was
// excluded from `files`, so the packaged app could not load the embedding
// worker and degraded to lexical scoring exactly as designed — silently. The
// build succeeded, the installer ran, nothing errored, and every measurement
// in eval/ described a code path no user was executing. Only a check that
// reads the packed output can catch that class of bug; a green build cannot.

const { spawnSync } = require('child_process')
const { join } = require('path')

exports.default = async function afterPack(context) {
  // The expectations are Windows-x64 specific (onnxruntime and sharp ship
  // per-platform binaries), so a mac build would fail them for the wrong
  // reason. Extend the check before enabling it there.
  if (context.electronPlatformName !== 'win32') {
    console.log(`  • skipping ML packaging check  platform=${context.electronPlatformName}`)
    return
  }

  const resources = join(context.appOutDir, 'resources')
  const script = join(__dirname, 'verify-packaged-ml.mjs')

  const result = spawnSync(process.execPath, [script, resources], { stdio: 'inherit' })

  if (result.error) {
    throw new Error(`ML packaging check could not run: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      'ML packaging check failed — see above. The installer was NOT built. ' +
        'Fix the `files` globs in electron-builder.yml, or run `npm run fetch-models`.'
    )
  }
}
