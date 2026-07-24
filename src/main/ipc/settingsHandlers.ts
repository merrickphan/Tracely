import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { SettingsSetResponse } from '@shared/ipc-contract'
import type { AppSettings, CitationStyle } from '@shared/types'
import { registerGlobalHotkey } from '../hotkey'
import { getConfig, setConfig } from '../services/storage/config'
import { getAllSettingsRaw, setSetting } from '../services/storage/settingsRepo'

const setSchema = z.object({
  defaultCitationStyle: z.enum(['APA', 'MLA', 'Chicago']).optional(),
  hotkeyAccelerator: z.string().optional(),
  crossrefMailto: z.string().optional(),
  enableStrengthSummaries: z.boolean().optional(),
  semanticScholarApiKey: z.string().optional()
})

function buildSettings(): AppSettings {
  const raw = getAllSettingsRaw()
  const config = getConfig()
  return {
    defaultCitationStyle: raw.defaultCitationStyle as CitationStyle,
    hotkeyAccelerator: raw.hotkeyAccelerator,
    crossrefMailto: raw.crossrefMailto,
    enableStrengthSummaries: raw.enableStrengthSummaries === 'true',
    hasSemanticScholarKey: Boolean(config.semanticScholarApiKey)
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, (): AppSettings => buildSettings())

  ipcMain.handle(IPC.SETTINGS_SET, (_event, raw): SettingsSetResponse => {
    const patch = setSchema.parse(raw)

    if (patch.defaultCitationStyle !== undefined) setSetting('defaultCitationStyle', patch.defaultCitationStyle)
    if (patch.crossrefMailto !== undefined) setSetting('crossrefMailto', patch.crossrefMailto)
    if (patch.enableStrengthSummaries !== undefined) {
      setSetting('enableStrengthSummaries', String(patch.enableStrengthSummaries))
    }
    if (patch.hotkeyAccelerator !== undefined) {
      setSetting('hotkeyAccelerator', patch.hotkeyAccelerator)
      registerGlobalHotkey(patch.hotkeyAccelerator)
    }
    if (patch.semanticScholarApiKey !== undefined) {
      setConfig({ semanticScholarApiKey: patch.semanticScholarApiKey })
    }

    return buildSettings()
  })
}
