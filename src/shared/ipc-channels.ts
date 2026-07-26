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

  HISTORY_CLEAR: 'history:clear',

  CLIPBOARD_READ: 'clipboard:read',
  CLIPBOARD_WRITE: 'clipboard:write',

  WINDOW_HIDE: 'window:hide',
  WINDOW_SHOW: 'window:show',
  WINDOW_CLOSE: 'window:close',

  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  SCREENWATCH_SET_ENABLED: 'screenWatch:setEnabled',
  SCREENWATCH_GET_STATUS: 'screenWatch:getStatus',
  SCREENWATCH_ANALYZE_CLAIM: 'screenWatch:analyzeClaim'
} as const

export const IPC_EVENTS = {
  FLOATING_CLIPBOARD_CAPTURED: 'floating:clipboardCaptured',
  SCREENWATCH_STATUS_CHANGED: 'screenWatch:statusChanged',
  SCREENWATCH_OVERLAY_UPDATE: 'screenWatch:overlayUpdate',
  SCREENWATCH_HOVER_CHANGED: 'screenWatch:hoverChanged'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
