import { appendFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

function getLogPath(): string {
  return join(app.getPath('userData'), 'screenwatch-debug.log')
}

export function resetScreenWatchLog(): void {
  try {
    writeFileSync(getLogPath(), `--- Screen Watch session started ${new Date().toISOString()} ---\n`)
  } catch {
    // Best-effort diagnostic logging; never let a logging failure affect the feature itself.
  }
}

export function logScreenWatch(line: string): void {
  console.log(`[screenWatch] ${line}`)
  try {
    appendFileSync(getLogPath(), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // See resetScreenWatchLog.
  }
}
