import type { DocumentOutline } from '@shared/types'

/**
 * The last structure analysis run inside Tracely's own document editor, held
 * so Tracer can answer questions about it.
 *
 * This exists because `getTracerContext()` sources entirely from Screen Watch,
 * which reads whatever EXTERNAL app is focused. While the user is writing in
 * Tracely's own editor, UIA reports `skip: "self"` and Screen Watch's snapshot
 * is whatever external document it saw last — so without this, asking Tracer
 * about the paragraph you are looking at would get an answer about a Word
 * document you closed an hour ago.
 *
 * Module-level state rather than a database row: it is a pointer to what the
 * user is doing right now, and it should die with the process exactly like
 * Screen Watch's own tracking state does.
 */

interface InAppContext {
  documentTitle: string
  documentText: string
  outline: DocumentOutline
  at: number
}

let current: InAppContext | null = null

export function setInAppOutlineContext(context: Omit<InAppContext, 'at'>): void {
  current = { ...context, at: Date.now() }
}

/**
 * The in-app context, or null if Screen Watch has seen something more
 * recently.
 *
 * Most-recent-wins rather than a fixed preference, and that is the right rule
 * in both directions: analysing a draft in the editor is a deliberate act and
 * should take over, but the moment the user alt-tabs back to Word and Screen
 * Watch reads it, Tracer should be talking about Word again.
 */
export function getInAppOutlineContext(screenWatchUpdatedAt: number | null): InAppContext | null {
  if (!current) return null
  if (screenWatchUpdatedAt !== null && screenWatchUpdatedAt > current.at) return null
  return current
}

export function clearInAppOutlineContext(): void {
  current = null
}
