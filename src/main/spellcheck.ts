import { Menu, MenuItem, session, type BrowserWindow } from 'electron'
import { getSetting, setSetting } from './services/storage/settingsRepo'

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

/**
 * Names taught to the dictionary for the document currently open.
 *
 * ── Why this bookkeeping exists ────────────────────────────────────────────
 * Electron offers exactly one way to stop Chromium underlining a word:
 * `addWordToSpellCheckerDictionary`, which writes to the user's PERSISTENT
 * custom dictionary. There is no per-session word list and no way to ask
 * Chromium whether it already knows a word.
 *
 * The owner asked for session-scoped (2026-08-19), and they were right to: a
 * name learned from one essay would otherwise stop being underlined in every
 * document they ever write, including the one where they spell it wrong. So
 * "session-scoped" here means added and then reliably REMOVED, and this Set is
 * what makes the removal possible — only words Tracely added are ever removed,
 * so a word the user added themselves through "Add to dictionary" is untouched.
 *
 * `learnedNamesForCleanup` in settings is the same list on disk, and it exists
 * for one case: the app not shutting down cleanly. Without it a crash leaves
 * the names in the dictionary permanently, which is precisely the outcome the
 * whole design is avoiding. It is read and cleared once at startup.
 */
const learned = new Set<string>()

/** How many names one document may teach. A cap on a loop over user text. */
const MAX_LEARNED_NAMES = 200

function forget(word: string): void {
  try {
    session.defaultSession.removeWordFromSpellCheckerDictionary(word)
  } catch {
    // Removing a word that is not there is not an error worth surfacing.
  }
}

/**
 * Teach the dictionary this document's names, and forget the previous one's.
 *
 * Called with the text of the document being analysed. Switching documents
 * therefore forgets the old names automatically — the new call replaces the
 * set — which is most of what "session-scoped" has to mean in practice.
 *
 * Idempotent: re-analysing an unchanged draft diffs to nothing and touches the
 * dictionary not at all.
 */
export function learnDocumentNames(names: string[]): void {
  const wanted = new Set(names.slice(0, MAX_LEARNED_NAMES))

  for (const word of learned) {
    if (!wanted.has(word)) {
      forget(word)
      learned.delete(word)
    }
  }
  for (const word of wanted) {
    if (learned.has(word)) continue
    try {
      session.defaultSession.addWordToSpellCheckerDictionary(word)
      learned.add(word)
    } catch {
      // A word the platform rejects simply stays underlined.
    }
  }
  persistLearned()
}

/**
 * Remove every name Tracely taught. Called on quit, and after a crash on the
 * next startup via `recoverLearnedNames`.
 */
export function forgetDocumentNames(): void {
  for (const word of learned) forget(word)
  learned.clear()
  persistLearned()
}

const LEARNED_SETTING = 'learnedNamesForCleanup'

function persistLearned(): void {
  try {
    setSetting(LEARNED_SETTING, JSON.stringify([...learned]))
  } catch {
    // Losing the cleanup list costs a stale name in the dictionary, not a
    // working feature. Never worth failing an analysis over.
  }
}

/**
 * Remove names left behind by a session that did not shut down cleanly.
 *
 * Runs once at startup, before anything is learned. Without it a crash makes
 * session-scoped learning permanent — the exact outcome the design exists to
 * prevent — and the user would have no idea which words to un-learn.
 */
export function recoverLearnedNames(): void {
  let stale: unknown
  try {
    stale = JSON.parse(getSetting(LEARNED_SETTING) || '[]')
  } catch {
    stale = []
  }
  if (!Array.isArray(stale)) return
  for (const word of stale) if (typeof word === 'string') forget(word)
  try {
    setSetting(LEARNED_SETTING, '[]')
  } catch {
    // Same as above.
  }
}

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
