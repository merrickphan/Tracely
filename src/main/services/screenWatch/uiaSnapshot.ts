import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ClaimSpanRequest {
  id: string
  start: number
  length: number
}

export interface ClaimRectResult {
  id: string
  rects: ScreenRect[]
  // Count of rects UIA returned before filtering out degenerate (off-screen)
  // ones — diagnostic only, lets us tell "provider returned nothing at all"
  // apart from "returned rects but they were all off-screen".
  rawRectCount?: number
}

export type UiaSnapshot =
  | { ok: true; skip: true; reason: string; processName?: string }
  | {
      ok: true
      skip: false
      processName: string
      text: string
      supportsTextPattern: boolean
      controlRect: ScreenRect
      claimRects: ClaimRectResult[]
    }
  | { ok: false; error: string }

const SCRIPT_TIMEOUT_MS = 4000

function getScriptPath(): string {
  return is.dev
    ? join(app.getAppPath(), 'resources', 'uia-watch.ps1')
    : join(process.resourcesPath, 'uia-watch.ps1')
}

/**
 * Runs the UIA snapshot script once and returns its parsed result. Spawned
 * fresh per call (rather than kept alive) to avoid async-stdin complexity in
 * the PowerShell side — see resources/uia-watch.ps1 for why.
 */
export function takeUiaSnapshot(spans: ClaimSpanRequest[]): Promise<UiaSnapshot> {
  return new Promise((resolve) => {
    const spansB64 =
      spans.length > 0 ? Buffer.from(JSON.stringify(spans), 'utf-8').toString('base64') : ''

    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        getScriptPath(),
        '-SpansB64',
        spansB64,
        '-SelfProcessName',
        `${app.name}.exe`
      ],
      { windowsHide: true }
    )

    let stdout = ''
    let settled = false

    const finish = (result: UiaSnapshot): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, error: 'uia-watch.ps1 timed out' })
    }, SCRIPT_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      finish({ ok: false, error: err.message })
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        finish(JSON.parse(stdout.trim()) as UiaSnapshot)
      } catch {
        finish({ ok: false, error: 'Unparseable output from uia-watch.ps1' })
      }
    })
  })
}
