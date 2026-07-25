import type { TracelyApi } from './index'

export {}

declare global {
  interface Window {
    tracely: TracelyApi
  }
}
