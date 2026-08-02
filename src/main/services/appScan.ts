import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

const SCRIPT_TIMEOUT_MS = 8000

function getScriptPath(): string {
  return is.dev
    ? join(app.getAppPath(), 'resources', 'scan-apps.ps1')
    : join(process.resourcesPath, 'scan-apps.ps1')
}

export interface ScannedApp {
  // Human-readable name from the registry's installed-programs list (e.g.
  // "Google Chrome"), for display.
  name: string
  // Resolved .exe basename (e.g. "chrome.exe"), for matching against the
  // focused window's real process name.
  exe: string
}

/**
 * Best-effort scan of Windows' installed-programs registry data (the same
 * source Windows Settings > Apps reads) for installed apps, used to show a
 * real Screen Watch blocklist checklist instead of a generic fixed list.
 * Registry entries that can't be resolved to an actual, existing .exe are
 * dropped rather than shown wrong (see scan-apps.ps1) — callers should
 * treat an empty/failed result as "couldn't tell," not "nothing is
 * installed," and let the user add an app manually by exe name instead.
 */
export function scanInstalledApps(): Promise<ScannedApp[]> {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', getScriptPath()],
      { windowsHide: true }
    )

    let stdout = ''
    let settled = false

    const finish = (result: ScannedApp[]): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish([])
    }, SCRIPT_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish([])
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(stdout.trim()) as { ok: boolean; apps?: ScannedApp[] }
        finish(parsed.ok && Array.isArray(parsed.apps) ? parsed.apps : [])
      } catch {
        finish([])
      }
    })
  })
}
