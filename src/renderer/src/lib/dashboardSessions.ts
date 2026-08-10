import {
  INITIAL_DASHBOARD_SESSIONS,
  type DashboardSession,
  type SessionStatus
} from '../data/dashboardMockData'

const STORAGE_KEY = 'tracely.dashboard.sessions.v1'
const MAX_STORED_SESSIONS = 20
const STATUS_VALUES: SessionStatus[] = ['supported', 'mixed', 'review']

function isDashboardSession(value: unknown): value is DashboardSession {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DashboardSession>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.sourceText === 'string' &&
    typeof candidate.dateLabel === 'string' &&
    (candidate.mode === 'evidence' || candidate.mode === 'critique') &&
    STATUS_VALUES.includes(candidate.status as SessionStatus) &&
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.highlights) &&
    candidate.highlights.every((item) => typeof item === 'string')
  )
}

export function loadDashboardSessions(): DashboardSession[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return INITIAL_DASHBOARD_SESSIONS.map((session) => ({ ...session }))
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return INITIAL_DASHBOARD_SESSIONS.map((session) => ({ ...session }))
    const sessions = parsed.filter(isDashboardSession).slice(0, MAX_STORED_SESSIONS)
    return sessions.length > 0 ? sessions : INITIAL_DASHBOARD_SESSIONS.map((session) => ({ ...session }))
  } catch {
    return INITIAL_DASHBOARD_SESSIONS.map((session) => ({ ...session }))
  }
}

export function saveDashboardSessions(sessions: DashboardSession[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_STORED_SESSIONS)))
  } catch {
    // Persistence is a convenience. A disabled or full localStorage should
    // never prevent the user from running a session in the current window.
  }
}
