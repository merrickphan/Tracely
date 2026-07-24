import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import dotenv from 'dotenv'

export interface AppConfig {
  semanticScholarApiKey: string | null
}

let config: AppConfig | null = null
let configPath: string | null = null

function getConfigPath(): string {
  if (!configPath) {
    configPath = join(app.getPath('userData'), 'config.json')
  }
  return configPath
}

function loadEnvDefaults(): void {
  dotenv.config({ path: join(app.getAppPath(), '.env') })
}

export function getConfig(): AppConfig {
  if (config) return config

  const path = getConfigPath()
  if (existsSync(path)) {
    config = JSON.parse(readFileSync(path, 'utf-8')) as AppConfig
    return config
  }

  loadEnvDefaults()
  config = {
    semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY || null
  }
  writeFileSync(path, JSON.stringify(config, null, 2))
  return config
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const current = getConfig()
  config = { ...current, ...patch }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2))
  return config
}
