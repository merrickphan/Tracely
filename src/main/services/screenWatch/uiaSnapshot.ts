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
  // Diagnostic-only fields below, temporary while chasing down a provider
  // (confirmed: Windows 11 Notepad) that returns zero bounding rects for a
  // range built from character offsets. rawRectCount distinguishes "provider
  // returned nothing at all" from "returned rects but they were all
  // off-screen"; rangeTextPreview confirms whether the offset math actually
  // landed the range on the right text in the first place; the *Error
  // fields catch exceptions that would otherwise be silently swallowed.
  rawRectCount?: number
  rangeTextPreview?: string | null
  moveError?: string | null
  scrollError?: string | null
  rectError?: string | null
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
      // Diagnostic-only, see the comment on ClaimRectResult.
      wholeDocRectCount?: number
      visibleRangeCount?: number
      visibleRangeRectCount?: number
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
    let stderr = ''
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
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
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
        // Was previously just "Unparseable output from uia-watch.ps1" with no
        // way to tell what actually went wrong — the two live candidates are
        // (a) the script hit a terminating error before its own catch could
        // run (rare, since almost everything is wrapped), which lands on
        // stderr, not stdout, or (b) PowerShell's transcript/verbose/warning
        // streams leaking non-JSON text onto stdout ahead of our own output.
        // Truncated snippets of both let a future occurrence actually be
        // diagnosed from the log instead of hitting this same dead end again.
        const stdoutSnippet = stdout.trim().slice(0, 300)
        const stderrSnippet = stderr.trim().slice(0, 300)
        finish({
          ok: false,
          error: `Unparseable output from uia-watch.ps1 (stdout: ${JSON.stringify(stdoutSnippet)}, stderr: ${JSON.stringify(stderrSnippet)})`
        })
      }
    })
  })
}
