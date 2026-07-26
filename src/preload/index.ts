import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENTS } from '@shared/ipc-channels'
import type {
  AnalyzeDetectClaimsRequest,
  AnalyzeDetectClaimsResponse,
  AnalyzeGetResultRequest,
  AnalyzeGetResultResponse,
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
  LibrarySaveRequest,
  LibrarySaveResponse,
  LibraryUpdateRequest,
  LibraryUpdateResponse,
  ScreenWatchGetStatusResponse,
  ScreenWatchOverlayUpdateEvent,
  ScreenWatchSetEnabledRequest,
  ScreenWatchSetEnabledResponse,
  ScreenWatchStatus,
  SettingsSetRequest,
  SettingsSetResponse,
  ShellOpenExternalRequest,
  ShellOpenExternalResponse,
  WindowTargetRequest,
  WindowTargetResponse
} from '@shared/ipc-contract'
import type { AppSettings } from '@shared/types'

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
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET, {}),
    set: (req: SettingsSetRequest): Promise<SettingsSetResponse> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, req)
  },
  history: {
    clear: (req: HistoryClearRequest): Promise<HistoryClearResponse> =>
      ipcRenderer.invoke(IPC.HISTORY_CLEAR, req)
  },
  clipboard: {
    read: (): Promise<ClipboardReadResponse> => ipcRenderer.invoke(IPC.CLIPBOARD_READ, {}),
    write: (req: ClipboardWriteRequest): Promise<ClipboardWriteResponse> =>
      ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, req)
  },
  window: {
    hide: (req: WindowTargetRequest): Promise<WindowTargetResponse> =>
      ipcRenderer.invoke(IPC.WINDOW_HIDE, req),
    show: (req: WindowTargetRequest): Promise<WindowTargetResponse> =>
      ipcRenderer.invoke(IPC.WINDOW_SHOW, req),
    close: (req: WindowTargetRequest): Promise<WindowTargetResponse> =>
      ipcRenderer.invoke(IPC.WINDOW_CLOSE, req)
  },
  shell: {
    openExternal: (req: ShellOpenExternalRequest): Promise<ShellOpenExternalResponse> =>
      ipcRenderer.invoke(IPC.SHELL_OPEN_EXTERNAL, req)
  },
  screenWatch: {
    setEnabled: (req: ScreenWatchSetEnabledRequest): Promise<ScreenWatchSetEnabledResponse> =>
      ipcRenderer.invoke(IPC.SCREENWATCH_SET_ENABLED, req),
    getStatus: (): Promise<ScreenWatchGetStatusResponse> => ipcRenderer.invoke(IPC.SCREENWATCH_GET_STATUS, {})
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
  }
}

export type TracelyApi = typeof api

contextBridge.exposeInMainWorld('tracely', api)
