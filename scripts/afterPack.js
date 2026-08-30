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
  const platform = context.electronPlatformName
  if (platform !== 'win32' && platform !== 'darwin') {
    console.log(`  • skipping ML packaging check  platform=${platform}`)
    return
  }

  // Resources live beside the exe on Windows and inside the bundle on mac.
  // The darwin path went unchecked while this hook skipped non-win32, and the
  // first real mac dmg shipped with only the win32 onnxruntime binding —
  // silent lexical degradation, the exact class this hook exists to stop.
  const resources =
    platform === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources')
  const script = join(__dirname, 'verify-packaged-ml.mjs')

  const result = spawnSync(process.execPath, [script, resources, platform], { stdio: 'inherit' })

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
