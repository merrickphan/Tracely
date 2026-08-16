import { strictEqual } from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldInstallImmediately } from './updatePolicy.ts'

describe('shouldInstallImmediately', () => {
  const idlePreview = { isPreview: true, hasVisibleWindow: false, screenWatchActive: false }

  it('installs a preview build that is parked in the tray', () => {
    // The resting state for this app: window-all-closed keeps it alive so the
    // global hotkey still works, so "no window on screen" is normal, not rare.
    // This is the case that makes two testers converge without either clicking.
    strictEqual(shouldInstallImmediately(idlePreview), true)
  })

  it('never installs a production build unprompted, however idle', () => {
    // Production users did not sign up to have the app restart under them.
    strictEqual(shouldInstallImmediately({ ...idlePreview, isPreview: false }), false)
  })

  it('waits while a window is on screen', () => {
    strictEqual(shouldInstallImmediately({ ...idlePreview, hasVisibleWindow: true }), false)
  })

  it('waits while Screen Watch is running', () => {
    // The user is mid-sentence in Word; the overlay disappearing under them
    // reads as a crash, not as an update.
    strictEqual(shouldInstallImmediately({ ...idlePreview, screenWatchActive: true }), false)
  })

  it('requires every condition at once', () => {
    strictEqual(
      shouldInstallImmediately({
        isPreview: true,
        hasVisibleWindow: true,
        screenWatchActive: true
      }),
      false
    )
  })
})
