import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSettings, saveSettings } from './settingsManager'

let tmpDir: string
let originalEnv: string | undefined

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-settings-'))
  originalEnv = process.env.CLAUDESOLE_SETTINGS_PATH
  process.env.CLAUDESOLE_SETTINGS_PATH = path.join(tmpDir, 'deep', 'nested', 'settings.json')
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env.CLAUDESOLE_SETTINGS_PATH
  else process.env.CLAUDESOLE_SETTINGS_PATH = originalEnv
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

describe('getSettings', () => {
  it('returns the built-in defaults when the file is missing', () => {
    const s = getSettings()
    expect(s.titleProvider).toBe('anthropic')
    expect(s.apiKey).toBe('')
    expect(s.model).toBe('claude-haiku-4-5-20251001')
    expect(s.baseUrl).toBe('')
  })

  it('merges a partial file over the defaults', () => {
    const p = process.env.CLAUDESOLE_SETTINGS_PATH!
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify({ titleProvider: 'none', apiKey: 'sk-abc' }))
    const s = getSettings()
    expect(s.titleProvider).toBe('none')
    expect(s.apiKey).toBe('sk-abc')
    // Unset fields fall back to defaults.
    expect(s.model).toBe('claude-haiku-4-5-20251001')
  })

  it('falls back to defaults when the file contains invalid JSON', () => {
    const p = process.env.CLAUDESOLE_SETTINGS_PATH!
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, '{not json')
    expect(getSettings().titleProvider).toBe('anthropic')
  })
})

describe('saveSettings', () => {
  it('creates the parent directory if missing and writes valid JSON', () => {
    const updated = { titleProvider: 'openai-compatible' as const, apiKey: 'key', model: 'm', baseUrl: 'https://api' }
    saveSettings(updated)
    const p = process.env.CLAUDESOLE_SETTINGS_PATH!
    expect(fs.existsSync(p)).toBe(true)
    expect(JSON.parse(fs.readFileSync(p, 'utf-8'))).toEqual(updated)
  })

  it('round-trips via getSettings', () => {
    const updated = { titleProvider: 'none' as const, apiKey: '', model: 'claude', baseUrl: '' }
    saveSettings(updated)
    expect(getSettings()).toEqual(updated)
  })
})
