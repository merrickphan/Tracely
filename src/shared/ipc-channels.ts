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
  SCREENWATCH_SET_WIDGET_EXPANDED: 'screenWatch:setWidgetExpanded',
  SCREENWATCH_SET_WIDGET_VIEW_MODE: 'screenWatch:setWidgetViewMode',
  SCREENWATCH_REFRESH_EVIDENCE: 'screenWatch:refreshEvidence',
  SCREENWATCH_CRITIQUE_CLAIM: 'screenWatch:critiqueClaim',
  SCREENWATCH_WIDGET_DRAG_START: 'screenWatch:widgetDragStart',
  SCREENWATCH_WIDGET_DRAG_END: 'screenWatch:widgetDragEnd',
  SCREENWATCH_SET_ACTIVE_POPOVER_RECT: 'screenWatch:setActivePopoverRect',
  SCREENWATCH_FIND_SOURCE: 'screenWatch:findSource',
  SCREENWATCH_INSERT_CITATION: 'screenWatch:insertCitation',
  SCREENWATCH_UNDO_CITATION: 'screenWatch:undoCitation',

  AUTH_GET_USER: 'auth:getUser',
  AUTH_SIGN_UP: 'auth:signUp',
  AUTH_SIGN_IN: 'auth:signIn',
  AUTH_SIGN_OUT: 'auth:signOut',
  AUTH_SIGN_IN_WITH_GOOGLE: 'auth:signInWithGoogle',
  AUTH_UPDATE_NAME: 'auth:updateName',
  AUTH_UPDATE_USERNAME: 'auth:updateUsername',
  AUTH_DELETE_ACCOUNT: 'auth:deleteAccount'
} as const

export const IPC_EVENTS = {
  FLOATING_CLIPBOARD_CAPTURED: 'floating:clipboardCaptured',
  SCREENWATCH_STATUS_CHANGED: 'screenWatch:statusChanged',
  SCREENWATCH_OVERLAY_UPDATE: 'screenWatch:overlayUpdate',
  SCREENWATCH_HOVER_CHANGED: 'screenWatch:hoverChanged',
  AUTH_STATE_CHANGED: 'auth:stateChanged',
  AUTH_OAUTH_ERROR: 'auth:oauthError'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEvent = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]
