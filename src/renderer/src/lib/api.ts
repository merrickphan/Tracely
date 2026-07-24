export class FolioApiError extends Error {}

async function call<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new FolioApiError(message.replace(/^Error invoking remote method '[^']*':\s*/, ''))
  }
}

export const folioApi = {
  detectClaims: (text: string, origin: 'main' | 'floating') =>
    call(window.folio.analyze.detectClaims({ text, origin })),
  getAnalysisResult: (analysisId: string) =>
    call(window.folio.analyze.getResult({ analysisId })),

  findEvidence: (claimId: string) => call(window.folio.evidence.find({ claimId })),
  getEvidenceForClaim: (claimId: string) =>
    call(window.folio.evidence.getForClaim({ claimId })),

  generateCitation: (sourceId: string, style: 'APA' | 'MLA' | 'Chicago') =>
    call(window.folio.citation.generate({ sourceId, style })),
  listCitations: (sourceId: string) => call(window.folio.citation.list({ sourceId })),

  generateCritique: (claimId: string) => call(window.folio.critique.generate({ claimId })),

  saveToLibrary: (sourceId: string, claimId?: string, notes?: string, tags?: string[]) =>
    call(window.folio.library.save({ sourceId, claimId, notes, tags })),
  listLibrary: (search?: string, tag?: string) =>
    call(window.folio.library.list({ search, tag })),
  getLibraryItem: (id: string) => call(window.folio.library.get({ id })),
  updateLibraryItem: (id: string, notes?: string, tags?: string[]) =>
    call(window.folio.library.update({ id, notes, tags })),
  removeLibraryItem: (id: string) => call(window.folio.library.remove({ id })),

  getSettings: () => call(window.folio.settings.get()),
  setSettings: (patch: Parameters<typeof window.folio.settings.set>[0]) =>
    call(window.folio.settings.set(patch)),

  clearHistory: (includeLibrary: boolean) =>
    call(window.folio.history.clear({ includeLibrary })),

  readClipboard: () => call(window.folio.clipboard.read()),
  writeClipboard: (text: string) => call(window.folio.clipboard.write({ text })),

  showWindow: (target: 'main' | 'floating') => call(window.folio.window.show({ target })),
  hideWindow: (target: 'main' | 'floating') => call(window.folio.window.hide({ target })),

  openExternal: (url: string) => call(window.folio.shell.openExternal({ url })),

  onClipboardCaptured: (cb: (payload: { text: string }) => void) =>
    window.folio.onClipboardCaptured(cb)
}
