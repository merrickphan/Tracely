import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENTS } from '@shared/ipc-channels'
import type {
  AppGetBuildInfoResponse,
  AnalyzeDetectClaimsRequest,
  AnalyzeDetectClaimsResponse,
  AnalyzeGetResultRequest,
  AnalyzeGetResultResponse,
  AuthDeleteAccountResponse,
  AuthGetUserResponse,
  AuthSignInRequest,
  AuthSignInWithGoogleResponse,
  AuthSignOutResponse,
  AuthSignResponse,
  AuthSignUpRequest,
  AuthUpdateNameRequest,
  AuthUpdateNameResponse,
  AuthUpdateUsernameRequest,
  AuthUpdateUsernameResponse,
  CitationGenerateRequest,
  CitationGenerateResponse,
  CitationListRequest,
  CitationListResponse,
  ClipboardReadResponse,
  ClipboardWriteRequest,
  ClipboardWriteResponse,
  CritiqueGenerateRequest,
  CritiqueGenerateResponse,
  EvidenceFindRequest,
  EvidenceFindResponse,
  EvidenceGetForClaimRequest,
  EvidenceGetForClaimResponse,
  FloatingClipboardCapturedEvent,
  HistoryClearRequest,
  HistoryClearResponse,
  LibraryGetRequest,
  LibraryGetResponse,
  LibraryListRequest,
  LibraryListResponse,
  LibraryRemoveRequest,
  LibraryRemoveResponse,
  DocumentsGetRequest,
  DocumentsGetResponse,
  DocumentsLatestResponse,
  DocumentsListResponse,
  DocumentsRemoveRequest,
  DocumentsRemoveResponse,
  DocumentsSaveRequest,
  DocumentsSaveResponse,
  LibrarySaveRequest,
  LibrarySaveResponse,
  LibraryUpdateRequest,
  LibraryUpdateResponse,
  ProfileGetResponse,
  ProfileSetRequest,
  ProfileSetResponse,
  ScreenWatchCritiqueClaimRequest,
  ScreenWatchCritiqueClaimResponse,
  ScreenWatchFindSourceRequest,
  ScreenWatchFindSourceResponse,
  ScreenWatchGetStatusResponse,
  ScreenWatchHoverEvent,
  ScreenWatchInsertCitationRequest,
  ScreenWatchInsertCitationResponse,
  ScreenWatchPreviewCitationRequest,
  ScreenWatchPreviewCitationResponse,
  ScreenWatchOverlayUpdateEvent,
  ScreenWatchRefreshEvidenceRequest,
  ScreenWatchRefreshEvidenceResponse,
  ScreenWatchSetActivePopoverRectRequest,
  ScreenWatchSetActivePopoverRectResponse,
  ScreenWatchSetEnabledRequest,
  ScreenWatchSetEnabledResponse,
  ScreenWatchSetWidgetExpandedRequest,
  ScreenWatchSetWidgetExpandedResponse,
  ScreenWatchSetWidgetViewModeRequest,
  ScreenWatchSetWidgetViewModeResponse,
  ScreenWatchStatus,
  ScreenWatchUndoCitationRequest,
  ScreenWatchUndoCitationResponse,
  ScreenWatchWidgetDragEndRequest,
  ScreenWatchWidgetDragEndResponse,
  ScreenWatchWidgetDragStartResponse,
  SettingsScanInstalledAppsResponse,
  SettingsSetRequest,
  SettingsSetResponse,
  StructureAnalyzeRequest,
  StructureAnalyzeResponse,
  StructureGetRequest,
  StructureGetResponse,
  ShellOpenExternalRequest,
  ShellOpenExternalResponse,
  WindowTargetRequest,
  WindowTargetResponse
} from '@shared/ipc-contract'
import type { AppSettings, AuthUser } from '@shared/types'

const api = {
  analyze: {
    detectClaims: (req: AnalyzeDetectClaimsRequest): Promise<AnalyzeDetectClaimsResponse> =>
      ipcRenderer.invoke(IPC.ANALYZE_DETECT_CLAIMS, req),
    getResult: (req: AnalyzeGetResultRequest): Promise<AnalyzeGetResultResponse> =>
      ipcRenderer.invoke(IPC.ANALYZE_GET_RESULT, req)
  },
  evidence: {
    find: (req: EvidenceFindRequest): Promise<EvidenceFindResponse> =>
      ipcRenderer.invoke(IPC.EVIDENCE_FIND, req),
    getForClaim: (req: EvidenceGetForClaimRequest): Promise<EvidenceGetForClaimResponse> =>
      ipcRenderer.invoke(IPC.EVIDENCE_GET_FOR_CLAIM, req)
  },
  citation: {
    generate: (req: CitationGenerateRequest): Promise<CitationGenerateResponse> =>
      ipcRenderer.invoke(IPC.CITATION_GENERATE, req),
    list: (req: CitationListRequest): Promise<CitationListResponse> =>
      ipcRenderer.invoke(IPC.CITATION_LIST, req)
  },
  critique: {
    generate: (req: CritiqueGenerateRequest): Promise<CritiqueGenerateResponse> =>
      ipcRenderer.invoke(IPC.CRITIQUE_GENERATE, req)
  },
  library: {
    save: (req: LibrarySaveRequest): Promise<LibrarySaveResponse> =>
      ipcRenderer.invoke(IPC.LIBRARY_SAVE, req),
    list: (req: LibraryListRequest): Promise<LibraryListResponse> =>
      ipcRenderer.invoke(IPC.LIBRARY_LIST, req),
    get: (req: LibraryGetRequest): Promise<LibraryGetResponse> =>
      ipcRenderer.invoke(IPC.LIBRARY_GET, req),
    update: (req: LibraryUpdateRequest): Promise<LibraryUpdateResponse> =>
      ipcRenderer.invoke(IPC.LIBRARY_UPDATE, req),
    remove: (req: LibraryRemoveRequest): Promise<LibraryRemoveResponse> =>
      ipcRenderer.invoke(IPC.LIBRARY_REMOVE, req)
  },
  documents: {
    list: (): Promise<DocumentsListResponse> => ipcRenderer.invoke(IPC.DOCUMENTS_LIST, {}),
    get: (req: DocumentsGetRequest): Promise<DocumentsGetResponse> =>
      ipcRenderer.invoke(IPC.DOCUMENTS_GET, req),
    latest: (): Promise<DocumentsLatestResponse> => ipcRenderer.invoke(IPC.DOCUMENTS_LATEST, {}),
    save: (req: DocumentsSaveRequest): Promise<DocumentsSaveResponse> =>
      ipcRenderer.invoke(IPC.DOCUMENTS_SAVE, req),
    remove: (req: DocumentsRemoveRequest): Promise<DocumentsRemoveResponse> =>
      ipcRenderer.invoke(IPC.DOCUMENTS_REMOVE, req)
  },
  structure: {
    analyze: (req: StructureAnalyzeRequest): Promise<StructureAnalyzeResponse> =>
      ipcRenderer.invoke(IPC.STRUCTURE_ANALYZE, req),
    get: (req: StructureGetRequest): Promise<StructureGetResponse> =>
      ipcRenderer.invoke(IPC.STRUCTURE_GET, req)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET, {}),
    set: (req: SettingsSetRequest): Promise<SettingsSetResponse> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, req),
    scanInstalledApps: (): Promise<SettingsScanInstalledAppsResponse> =>
      ipcRenderer.invoke(IPC.SETTINGS_SCAN_INSTALLED_APPS, {})
  },
  profile: {
    get: (): Promise<ProfileGetResponse> => ipcRenderer.invoke(IPC.PROFILE_GET, {}),
    set: (req: ProfileSetRequest): Promise<ProfileSetResponse> => ipcRenderer.invoke(IPC.PROFILE_SET, req)
  },
  auth: {
    getUser: (): Promise<AuthGetUserResponse> => ipcRenderer.invoke(IPC.AUTH_GET_USER, {}),
    signUp: (req: AuthSignUpRequest): Promise<AuthSignResponse> => ipcRenderer.invoke(IPC.AUTH_SIGN_UP, req),
    signIn: (req: AuthSignInRequest): Promise<AuthSignResponse> => ipcRenderer.invoke(IPC.AUTH_SIGN_IN, req),
    signOut: (): Promise<AuthSignOutResponse> => ipcRenderer.invoke(IPC.AUTH_SIGN_OUT, {}),
    signInWithGoogle: (): Promise<AuthSignInWithGoogleResponse> =>
      ipcRenderer.invoke(IPC.AUTH_SIGN_IN_WITH_GOOGLE, {}),
    updateName: (req: AuthUpdateNameRequest): Promise<AuthUpdateNameResponse> =>
      ipcRenderer.invoke(IPC.AUTH_UPDATE_NAME, req),
    updateUsername: (req: AuthUpdateUsernameRequest): Promise<AuthUpdateUsernameResponse> =>
      ipcRenderer.invoke(IPC.AUTH_UPDATE_USERNAME, req),
    deleteAccount: (): Promise<AuthDeleteAccountResponse> => ipcRenderer.invoke(IPC.AUTH_DELETE_ACCOUNT, {})
  },
  history: {
    clear: (req: HistoryClearRequest): Promise<HistoryClearResponse> =>
      ipcRenderer.invoke(IPC.HISTORY_CLEAR, req)
  },
  clipboard: {
    // No `read`. It had zero renderer callers — the global hotkey reads the
    // clipboard main-side (hotkey.ts) — so it was an unnecessary
    // read-the-user's-clipboard capability sitting on the bridge.
    write: (req: ClipboardWriteRequest): Promise<ClipboardWriteResponse> =>
      ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, req)
  },
  window: {
    hide: (req: WindowTargetRequest): Promise<WindowTargetResponse> =>
      ipcRenderer.invoke(IPC.WINDOW_HIDE, req),
    show: (req: WindowTargetRequest): Promise<WindowTargetResponse> =>
      ipcRenderer.invoke(IPC.WINDOW_SHOW, req)
    // No `close`. Its handler was byte-identical to `hide` — both called
    // .hide() — and it had zero callers.
  },
  shell: {
    openExternal: (req: ShellOpenExternalRequest): Promise<ShellOpenExternalResponse> =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, req)
  },
  app: {
    getBuildInfo: (): Promise<AppGetBuildInfoResponse> => ipcRenderer.invoke(IPC.APP_GET_BUILD_INFO, {})
  },
  screenWatch: {
    setEnabled: (req: ScreenWatchSetEnabledRequest): Promise<ScreenWatchSetEnabledResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_SET_ENABLED, req),
    getStatus: (): Promise<ScreenWatchGetStatusResponse> => ipcRenderer.invoke(IPC.SCREENWATCH_GET_STATUS, {}),
    setWidgetExpanded: (req: ScreenWatchSetWidgetExpandedRequest): Promise<ScreenWatchSetWidgetExpandedResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_SET_WIDGET_EXPANDED, req),
    setWidgetViewMode: (req: ScreenWatchSetWidgetViewModeRequest): Promise<ScreenWatchSetWidgetViewModeResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_SET_WIDGET_VIEW_MODE, req),
    widgetDragStart: (): Promise<ScreenWatchWidgetDragStartResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_WIDGET_DRAG_START, {}),
    widgetDragEnd: (req: ScreenWatchWidgetDragEndRequest): Promise<ScreenWatchWidgetDragEndResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_WIDGET_DRAG_END, req),
    setActivePopoverRect: (
      req: ScreenWatchSetActivePopoverRectRequest
    ): Promise<ScreenWatchSetActivePopoverRectResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_SET_ACTIVE_POPOVER_RECT, req),
    refreshEvidence: (req: ScreenWatchRefreshEvidenceRequest): Promise<ScreenWatchRefreshEvidenceResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_REFRESH_EVIDENCE, req),
    critiqueClaim: (req: ScreenWatchCritiqueClaimRequest): Promise<ScreenWatchCritiqueClaimResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_CRITIQUE_CLAIM, req),
    findSource: (req: ScreenWatchFindSourceRequest): Promise<ScreenWatchFindSourceResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_FIND_SOURCE, req),
    previewCitation: (req: ScreenWatchPreviewCitationRequest): Promise<ScreenWatchPreviewCitationResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_PREVIEW_CITATION, req),
    insertCitation: (req: ScreenWatchInsertCitationRequest): Promise<ScreenWatchInsertCitationResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_INSERT_CITATION, req),
    undoCitation: (req: ScreenWatchUndoCitationRequest): Promise<ScreenWatchUndoCitationResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_UNDO_CITATION, req)
  },
  onClipboardCaptured: (callback: (event: FloatingClipboardCapturedEvent) => void): (() => void) => {
    const listener = (_: unknown, payload: FloatingClipboardCapturedEvent): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.FLOATING_CLIPBOARD_CAPTURED, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.FLOATING_CLIPBOARD_CAPTURED, listener)
  },
  onScreenWatchStatus: (callback: (status: ScreenWatchStatus) => void): (() => void) => {
    const listener = (_: unknown, payload: ScreenWatchStatus): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.SCREENWATCH_STATUS_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.SCREENWATCH_STATUS_CHANGED, listener)
  },
  onScreenWatchOverlayUpdate: (callback: (event: ScreenWatchOverlayUpdateEvent) => void): (() => void) => {
    const listener = (_: unknown, payload: ScreenWatchOverlayUpdateEvent): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.SCREENWATCH_OVERLAY_UPDATE, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.SCREENWATCH_OVERLAY_UPDATE, listener)
  },
  onScreenWatchHover: (callback: (event: ScreenWatchHoverEvent | null) => void): (() => void) => {
    const listener = (_: unknown, payload: ScreenWatchHoverEvent | null): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.SCREENWATCH_HOVER_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.SCREENWATCH_HOVER_CHANGED, listener)
  },
  onAuthStateChanged: (callback: (user: AuthUser | null) => void): (() => void) => {
    const listener = (_: unknown, payload: AuthUser | null): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.AUTH_STATE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.AUTH_STATE_CHANGED, listener)
  },
  onAuthOAuthError: (callback: (message: string) => void): (() => void) => {
    const listener = (_: unknown, payload: string): void => callback(payload)
    ipcRenderer.on(IPC_EVENTS.AUTH_OAUTH_ERROR, listener)
    return () => ipcRenderer.removeListener(IPC_EVENTS.AUTH_OAUTH_ERROR, listener)
  }
}

export type TracelyApi = typeof api

contextBridge.exposeInMainWorld('tracely', api)
