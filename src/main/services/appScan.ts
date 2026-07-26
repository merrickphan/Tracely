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

/**
 * Best-effort scan of Start Menu shortcuts for installed apps, used to show
 * only relevant options in the Screen Watch blocklist checklist instead of
 * a generic fixed list. Misses portable installs and anything that doesn't
 * create a Start Menu shortcut — callers should treat an empty/failed
 * result as "couldn't tell," not "nothing is installed," and fall back to
 * showing the full candidate list.
 */
export function scanInstalledAppExeNames(): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', getScriptPath()],
      { windowsHide: true }
    )

    let stdout = ''
    let settled = false

    const finish = (result: string[]): void => {
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
        const parsed = JSON.parse(stdout.trim()) as { ok: boolean; apps?: string[] }
        finish(parsed.ok && Array.isArray(parsed.apps) ? parsed.apps : [])
      } catch {
        finish([])
      }
    })
  })
}
