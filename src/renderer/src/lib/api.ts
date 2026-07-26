export class TracelyApiError extends Error {}

async function call<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new TracelyApiError(message.replace(/^Error invoking remote method '[^']*':\s*/, ''))
  }
}

export const tracelyApi = {
  detectClaims: (text: string, origin: 'main' | 'floating') =>
    call(window.tracely.analyze.detectClaims({ text, origin })),
  getAnalysisResult: (analysisId: string) =>
    call(window.tracely.analyze.getResult({ analysisId })),

  findEvidence: (claimId: string) => call(window.tracely.evidence.find({ claimId })),
  getEvidenceForClaim: (claimId: string) =>
    call(window.tracely.evidence.getForClaim({ claimId })),

  generateCitation: (sourceId: string, style: 'APA' | 'MLA' | 'Chicago') =>
    call(window.tracely.citation.generate({ sourceId, style })),
  listCitations: (sourceId: string) => call(window.tracely.citation.list({ sourceId })),

  generateCritique: (claimId: string) => call(window.tracely.critique.generate({ claimId })),

  saveToLibrary: (sourceId: string, claimId?: string, notes?: string, tags?: string[]) =>
    call(window.tracely.library.save({ sourceId, claimId, notes, tags })),
  listLibrary: (search?: string, tag?: string) =>
    call(window.tracely.library.list({ search, tag })),
  getLibraryItem: (id: string) => call(window.tracely.library.get({ id })),
  updateLibraryItem: (id: string, notes?: string, tags?: string[]) =>
    call(window.tracely.library.update({ id, notes, tags })),
  removeLibraryItem: (id: string) => call(window.tracely.library.remove({ id })),

  getSettings: () => call(window.tracely.settings.get()),
  setSettings: (patch: Parameters<typeof window.tracely.settings.set>[0]) =>
    call(window.tracely.settings.set(patch)),

  clearHistory: (includeLibrary: boolean) =>
    call(window.tracely.history.clear({ includeLibrary })),

  readClipboard: () => call(window.tracely.clipboard.read()),
  writeClipboard: (text: string) => call(window.tracely.clipboard.write({ text })),

  showWindow: (target: 'main' | 'floating') => call(window.tracely.window.show({ target })),
  hideWindow: (target: 'main' | 'floating') => call(window.tracely.window.hide({ target })),
  minimizeWindow: () => call(window.tracely.window.minimize()),
  toggleMaximizeWindow: () => call(window.tracely.window.maximizeToggle()),
  isWindowMaximized: () => call(window.tracely.window.isMaximized()),
  onWindowMaximizeChanged: (cb: Parameters<typeof window.tracely.onWindowMaximizeChanged>[0]) =>
    window.tracely.onWindowMaximizeChanged(cb),

  openExternal: (url: string) => call(window.tracely.shell.openExternal({ url })),

  onClipboardCaptured: (cb: (payload: { text: string }) => void) =>
    window.tracely.onClipboardCaptured(cb),

  getScreenWatchStatus: () => call(window.tracely.screenWatch.getStatus()),
  setScreenWatchEnabled: (enabled: boolean) => call(window.tracely.screenWatch.setEnabled({ enabled })),
  onScreenWatchStatus: (cb: Parameters<typeof window.tracely.onScreenWatchStatus>[0]) =>
    window.tracely.onScreenWatchStatus(cb)
}
