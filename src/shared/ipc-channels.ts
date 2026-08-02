export const IPC = {
  ANALYZE_DETECT_CLAIMS: 'analyze:detectClaims',
  ANALYZE_GET_RESULT: 'analyze:getResult',

  EVIDENCE_FIND: 'evidence:find',
  EVIDENCE_GET_FOR_CLAIM: 'evidence:getForClaim',

  CITATION_GENERATE: 'citation:generate',
  CITATION_LIST: 'citation:list',

  CRITIQUE_GENERATE: 'critique:generate',

  LIBRARY_SAVE: 'library:save',
  LIBRARY_LIST: 'library:list',
  LIBRARY_GET: 'library:get',
  LIBRARY_UPDATE: 'library:update',
  LIBRARY_REMOVE: 'library:remove',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_SCAN_INSTALLED_APPS: 'settings:scanInstalledApps',

  LOCAL_MODEL_STATUS_GET: 'localModel:getStatus',
  LOCAL_MODEL_DOWNLOAD_START: 'localModel:startDownload',

  PROFILE_GET: 'profile:get',
  PROFILE_SET: 'profile:set',

  HISTORY_CLEAR: 'history:clear',

  CLIPBOARD_READ: 'clipboard:read',
  CLIPBOARD_WRITE: 'clipboard:write',

  WINDOW_HIDE: 'window:hide',
  WINDOW_SHOW: 'window:show',
  WINDOW_CLOSE: 'window:close',

  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  SCREENWATCH_SET_ENABLED: 'screenWatch:setEnabled',
  SCREENWATCH_GET_STATUS: 'screenWatch:getStatus',
  SCREENWATCH_ANALYZE_CLAIM: 'screenWatch:analyzeClaim',
  SCREENWATCH_SET_WIDGET_EXPANDED: 'screenWatch:setWidgetExpanded',
  SCREENWATCH_WIDGET_DRAG_START: 'screenWatch:widgetDragStart',
  SCREENWATCH_WIDGET_DRAG_END: 'screenWatch:widgetDragEnd',
  SCREENWATCH_SET_ACTIVE_POPOVER_RECT: 'screenWatch:setActivePopoverRect'
} as const

export const IPC_EVENTS = {
  FLOATING_CLIPBOARD_CAPTURED: 'floating:clipboardCaptured',
  SCREENWATCH_STATUS_CHANGED: 'screenWatch:statusChanged',
  SCREENWATCH_OVERLAY_UPDATE: 'screenWatch:overlayUpdate',
  SCREENWATCH_HOVER_CHANGED: 'screenWatch:hoverChanged',
  LOCAL_MODEL_DOWNLOAD_PROGRESS: 'localModel:downloadProgress'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
