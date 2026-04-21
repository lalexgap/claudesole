import fs from 'fs'
import path from 'path'
import os from 'os'

function settingsPath(): string {
  return process.env.CLAUDESOLE_SETTINGS_PATH ?? path.join(os.homedir(), '.claude', 'claudesole-settings.json')
}

export interface AppSettings {
  titleProvider: 'anthropic' | 'openai-compatible' | 'none'
  apiKey: string
  model: string
  baseUrl: string
}

const defaults: AppSettings = {
  titleProvider: 'anthropic',
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
  baseUrl: '',
}

export function getSettings(): AppSettings {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) }
  } catch {
    return { ...defaults }
  }
}

export function saveSettings(s: AppSettings): void {
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(s, null, 2))
}
