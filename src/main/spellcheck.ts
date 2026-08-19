import { Menu, MenuItem, session, type BrowserWindow } from 'electron'

/**
 * Chromium's own spell checker, turned on for the document editor.
 *
 * The renderer sets `spellCheck` on the contentEditable, which is what draws
 * the red squiggle. That alone is half a feature: a squiggle with no way to see
 * what the word should have been is a complaint. This wires the other half —
 * the context menu Chromium expects an Electron app to build itself, carrying
 * the suggestions it has already computed.
 *
 * Deliberately NOT a rule in `shared/proseIssues.ts`. That module is pattern
 * matching over the text with no dictionary behind it: it catches a repeated
 * word and "a apple", and it cannot catch "ctaclysm" without shipping a
 * dictionary and a checker that would be a worse copy of the one already in the
 * process.
 *
 * The dictionary is Chromium's, downloaded per language on first use and cached
 * in the user-data directory. Offline it degrades to no squiggles rather than
 * to wrong ones.
 */

/** en-US only. Adding a language picker is a Settings change, not a default. */
const LANGUAGES = ['en-US']

export function installSpellcheck(win: BrowserWindow): void {
  // On the window's own session so a build with no window open touches nothing.
  try {
    session.defaultSession.setSpellCheckerLanguages(LANGUAGES)
  } catch {
    // An unsupported locale must not take the window down with it; the editor
    // simply gets no squiggles.
  }

  win.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()
    let hasSuggestions = false

    for (const suggestion of params.dictionarySuggestions) {
      hasSuggestions = true
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion)
        })
      )
    }

    if (params.misspelledWord) {
      if (hasSuggestions) menu.append(new MenuItem({ type: 'separator' }))
      menu.append(
        new MenuItem({
          label: 'Add to dictionary',
          click: () =>
            session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord)
        })
      )
      menu.append(new MenuItem({ type: 'separator' }))
    }

    // The ordinary editing items, which a context menu built by hand does not
    // get for free. Roles rather than hand-written handlers so they carry the
    // platform's own labels and accelerators — and so Undo is the SAME undo
    // stack every edit in this app is careful to land on.
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'undo' }))
      menu.append(new MenuItem({ role: 'redo' }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ role: 'cut', enabled: params.editFlags.canCut }))
      menu.append(new MenuItem({ role: 'copy', enabled: params.editFlags.canCopy }))
      menu.append(new MenuItem({ role: 'paste', enabled: params.editFlags.canPaste }))
      menu.append(new MenuItem({ role: 'selectAll' }))
    } else if (params.selectionText.trim()) {
      menu.append(new MenuItem({ role: 'copy' }))
    }

    // Nothing to offer is not a reason to show an empty box.
    if (menu.items.length > 0) menu.popup({ window: win })
  })
}
