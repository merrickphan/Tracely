import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-channels'
import type { SettingsScanInstalledAppsResponse, SettingsSetResponse } from '@shared/ipc-contract'
import type { AccentColor, AppSettings, CitationStyle, Density, FontSize, Theme } from '@shared/types'
import { scanInstalledApps } from '../services/appScan'
import { registerGlobalHotkey, registerScreenWatchHotkey } from '../hotkey'
import { getAllSettingsRaw, setSetting } from '../services/storage/settingsRepo'

const setSchema = z.object({
  defaultCitationStyle: z.enum(['APA', 'MLA', 'Chicago']).optional(),
  hotkeyAccelerator: z.string().optional(),
  enableStrengthSummaries: z.boolean().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  accentColor: z.enum(['orange', 'blue', 'green', 'purple']).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
  fontSize: z.enum(['small', 'medium', 'large']).optional(),
  claimSensitivity: z.number().min(0).max(1).optional(),
  screenWatchHotkeyAccelerator: z.string().optional(),
  screenWatchAllowedApps: z.string().optional()
})

function buildSettings(): AppSettings {
  const raw = getAllSettingsRaw()
  return {
    defaultCitationStyle: raw.defaultCitationStyle as CitationStyle,
    hotkeyAccelerator: raw.hotkeyAccelerator,
    enableStrengthSummaries: raw.enableStrengthSummaries === 'true',
    theme: raw.theme as Theme,
    accentColor: raw.accentColor as AccentColor,
    density: raw.density as Density,
    fontSize: raw.fontSize as FontSize,
    claimSensitivity: Number(raw.claimSensitivity),
    screenWatchHotkeyAccelerator: raw.screenWatchHotkeyAccelerator,
    screenWatchAllowedApps: raw.screenWatchAllowedApps
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, (): AppSettings => buildSettings())

  ipcMain.handle(IPC.SETTINGS_SET, (_event, raw): SettingsSetResponse => {
    const patch = setSchema.parse(raw)

    if (patch.defaultCitationStyle !== undefined) setSetting('defaultCitationStyle', patch.defaultCitationStyle)
    if (patch.enableStrengthSummaries !== undefined) {
      setSetting('enableStrengthSummaries', String(patch.enableStrengthSummaries))
    }
    if (patch.theme !== undefined) setSetting('theme', patch.theme)
    if (patch.accentColor !== undefined) setSetting('accentColor', patch.accentColor)
    if (patch.density !== undefined) setSetting('density', patch.density)
    if (patch.fontSize !== undefined) setSetting('fontSize', patch.fontSize)
    if (patch.claimSensitivity !== undefined) setSetting('claimSensitivity', String(patch.claimSensitivity))
    if (patch.hotkeyAccelerator !== undefined) {
      setSetting('hotkeyAccelerator', patch.hotkeyAccelerator)
      registerGlobalHotkey(patch.hotkeyAccelerator)
    }
    if (patch.screenWatchHotkeyAccelerator !== undefined) {
      setSetting('screenWatchHotkeyAccelerator', patch.screenWatchHotkeyAccelerator)
      registerScreenWatchHotkey(patch.screenWatchHotkeyAccelerator)
    }
    if (patch.screenWatchAllowedApps !== undefined) {
      setSetting('screenWatchAllowedApps', patch.screenWatchAllowedApps)
    }

    return buildSettings()
  })

  ipcMain.handle(IPC.SETTINGS_SCAN_INSTALLED_APPS, async (): Promise<SettingsScanInstalledAppsResponse> => {
    const found = await scanInstalledApps()
    return { found }
  })
}
