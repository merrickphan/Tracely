import { registerAnalyzeHandlers } from './analyzeHandlers'
import { registerCitationHandlers } from './citationHandlers'
import { registerClipboardHandlers } from './clipboardHandlers'
import { registerCritiqueHandlers } from './critiqueHandlers'
import { registerEvidenceHandlers } from './evidenceHandlers'
import { registerHistoryHandlers } from './historyHandlers'
import { registerLibraryHandlers } from './libraryHandlers'
import { registerLocalModelHandlers } from './localModelHandlers'
import { registerProfileHandlers } from './profileHandlers'
import { registerScreenWatchHandlers } from './screenWatchHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerWindowHandlers } from './windowHandlers'

export function registerIpcHandlers(): void {
  registerAnalyzeHandlers()
  registerClipboardHandlers()
  registerWindowHandlers()
  registerSettingsHandlers()
  registerHistoryHandlers()
  registerEvidenceHandlers()
  registerCritiqueHandlers()
  registerCitationHandlers()
  registerLibraryHandlers()
  registerScreenWatchHandlers()
  registerProfileHandlers()
  registerLocalModelHandlers()
}
