/**
 * When a downloaded update may install itself without being asked.
 *
 * A leaf on purpose: `updater.ts` imports electron, so it cannot be loaded by
 * `node --test`, and this is the part with a wrong answer available. Keep the
 * file free of relative *value* imports — the test runner's ESM resolver
 * rejects the extensionless style used everywhere else in this codebase.
 *
 * "Is this a preview build?" is deliberately NOT decided here. `appIdentity.ts`
 * already answers it from `app.getName()`, which is what electron-builder sets
 * via `-c.extraMetadata.name=tracely-preview`. Deriving it a second way (say,
 * from the version's `-beta` suffix) would be a second truth that can disagree
 * with the first, and the disagreement would be silent.
 */

export interface InstallNowInput {
  /** A preview build. Production Tracely never installs without being asked. */
  isPreview: boolean
  /** Any Tracely window currently on screen (main, floating). */
  hasVisibleWindow: boolean
  /** Screen Watch is on, so the user is likely mid-sentence in another app. */
  screenWatchActive: boolean
}

/**
 * Whether a downloaded update may be installed right now, unprompted.
 *
 * Restarting is not free even though the user's own writing lives in Word or a
 * browser rather than in Tracely: the overlay vanishing mid-sentence, or a
 * window disappearing while it is being read, is the kind of thing a tester
 * reports as a crash. So an unprompted install requires the app to be doing
 * nothing visible — parked in the tray, which for this app is the normal
 * resting state, since `window-all-closed` deliberately keeps it alive so the
 * global hotkey keeps working.
 *
 * When this says no the update is not skipped: it is offered in a dialog, and
 * electron-updater's `autoInstallOnAppQuit` still applies. This decides
 * *silently now* versus *ask*, never *now* versus *never*.
 */
export function shouldInstallImmediately(input: InstallNowInput): boolean {
  if (!input.isPreview) return false
  if (input.hasVisibleWindow) return false
  if (input.screenWatchActive) return false
  return true
}
