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

  listDocuments: () => call(window.tracely.documents.list()),
  getDocument: (id: string) => call(window.tracely.documents.get({ id })),
  getLatestDocument: () => call(window.tracely.documents.latest()),
  saveDocument: (input: { id?: string | null; title: string; bodyHtml: string }) =>
    call(window.tracely.documents.save(input)),
  removeDocument: (id: string) => call(window.tracely.documents.remove({ id })),

  // The main window can open Tracer too now, not just the Screen Watch
  // overlay — the Structure rail's weaknesses each offer to talk one through.
  openTracer: (req: Parameters<typeof window.tracely.tracer.open>[0]) =>
    call(window.tracely.tracer.open(req)),

  analyzeStructure: (input: Parameters<typeof window.tracely.structure.analyze>[0]) =>
    call(window.tracely.structure.analyze(input)),
  getStructure: (documentId: string, text: string) =>
    call(window.tracely.structure.get({ documentId, text })),

  getSettings: () => call(window.tracely.settings.get()),
  setSettings: (patch: Parameters<typeof window.tracely.settings.set>[0]) =>
    call(window.tracely.settings.set(patch)),
  scanInstalledApps: () => call(window.tracely.settings.scanInstalledApps()),

  getProfile: () => call(window.tracely.profile.get()),
  setProfile: (patch: Parameters<typeof window.tracely.profile.set>[0]) =>
    call(window.tracely.profile.set(patch)),

  clearHistory: (includeLibrary: boolean) =>
    call(window.tracely.history.clear({ includeLibrary })),

  writeClipboard: (text: string) => call(window.tracely.clipboard.write({ text })),

  showWindow: (target: 'main' | 'floating') => call(window.tracely.window.show({ target })),
  hideWindow: (target: 'main' | 'floating') => call(window.tracely.window.hide({ target })),

  openExternal: (url: string) => call(window.tracely.shell.openExternal({ url })),

  onClipboardCaptured: (cb: (payload: { text: string }) => void) =>
    window.tracely.onClipboardCaptured(cb),

  getScreenWatchStatus: () => call(window.tracely.screenWatch.getStatus()),
  setScreenWatchEnabled: (enabled: boolean) => call(window.tracely.screenWatch.setEnabled({ enabled })),
  onScreenWatchStatus: (cb: Parameters<typeof window.tracely.onScreenWatchStatus>[0]) =>
    window.tracely.onScreenWatchStatus(cb),

  getAuthUser: () => call(window.tracely.auth.getUser()),
  signUp: (email: string, password: string, firstName: string) =>
    call(window.tracely.auth.signUp({ email, password, firstName })),
  signIn: (email: string, password: string) => call(window.tracely.auth.signIn({ email, password })),
  signOut: () => call(window.tracely.auth.signOut()),
  signInWithGoogle: () => call(window.tracely.auth.signInWithGoogle()),
  updateAuthName: (firstName: string) => call(window.tracely.auth.updateName({ firstName })),
  updateAuthUsername: (username: string) => call(window.tracely.auth.updateUsername({ username })),
  deleteAuthAccount: () => call(window.tracely.auth.deleteAccount()),
  onAuthStateChanged: (cb: Parameters<typeof window.tracely.onAuthStateChanged>[0]) =>
    window.tracely.onAuthStateChanged(cb),
  onAuthOAuthError: (cb: Parameters<typeof window.tracely.onAuthOAuthError>[0]) =>
    window.tracely.onAuthOAuthError(cb)
}
