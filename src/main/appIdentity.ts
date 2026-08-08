import { app } from 'electron'

// Telling a preview build apart from the real one, at a glance.
//
// Nothing did, before this. Every window is `frame: false` — the app IS the
// frame, not an OS window with a title bar — so the hardcoded `title: 'Tracely'`
// was invisible, and the tray tooltip said 'Tracely' in both builds. The two
// installs share an icon file, so the taskbar, Alt-Tab and the tray were
// identical. The only honest signals were the Start menu entry and the folder
// name under %APPDATA%, neither of which you see while using the app.
//
// That matters more than it sounds: a preview has its own database, so working
// in the wrong one means the analyses are written somewhere you will not find
// them later.
//
// electron-builder gives the preview `name: "tracely-preview"` (via
// -c.extraMetadata.name) and no productName, so app.getName() returns the raw
// package name — 'tracely-preview' or 'tracely'. Fine to branch on, not fine to
// show a user.

/** True in builds published by `npm run ship:preview`. */
export function isPreviewBuild(): boolean {
  return app.getName().endsWith('-preview')
}

/** What this build should call itself anywhere a person will read it. */
export function appDisplayName(): string {
  return isPreviewBuild() ? 'Tracely Preview' : 'Tracely'
}

/**
 * Window title. Invisible in the app's own chrome, but it is what Windows
 * shows on taskbar hover and in the Alt-Tab switcher — which is exactly where
 * you look when two copies are open.
 */
export function windowTitle(surface?: string): string {
  const base = appDisplayName()
  return surface ? `${surface} — ${base}` : base
}
