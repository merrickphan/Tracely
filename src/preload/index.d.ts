import type { FolioApi } from './index'

export {}

declare global {
  interface Window {
    folio: FolioApi
  }
}
