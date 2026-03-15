import fs from 'fs'
import path from 'path'
import os from 'os'
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { getEnv } from './ptyManager'
import { getSettings } from './settingsManager'

const CACHE_PATH = path.join(os.homedir(), '.claude', 'claudesole-titles.json')

interface CacheEntry { title: string; generatedAt: number }
type TitleCache = Record<string, CacheEntry>

let memCache: TitleCache = {}
let cacheLoaded = false

function loadCache(): TitleCache {
  if (cacheLoaded) return memCache
  try { memCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) } catch { memCache = {} }
  cacheLoaded = true
  return memCache
}

function saveCache(): void {
  try { fs.writeFileSync(CACHE_PATH, JSON.stringify(memCache, null, 2)) } catch {}
}

export function getCachedTitle(sessionId: string): string | undefined {
  return loadCache()[sessionId]?.title
}

export function getTitleCache(): Record<string, string> {
  const c = loadCache()
  return Object.fromEntries(Object.entries(c).map(([id, e]) => [id, e.title]))
}

function resolveApiKey(settingsKey: string): string | null {
  if (settingsKey) return settingsKey
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  const env = getEnv()
  if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY
  const claudeDir = path.join(os.homedir(), '.claude')
  for (const fname of ['settings.local.json', 'settings.json']) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(claudeDir, fname), 'utf-8'))
      if (typeof p.apiKey === 'string' && p.apiKey) return p.apiKey
    } catch {}
  }
  return null
}

export function getCachedSummary(sessionId: string): string | undefined {
  return loadCache()[`${sessionId}:summary`]?.title
}

const inFlight = new Set<string>()

export async function generateSummary(
  sessionId: string, firstPrompt: string, latestPrompt?: string
): Promise<string | null> {
  const key = `${sessionId}:summary`
  const cached = loadCache()[key]?.title
  if (cached) return cached
  if (inFlight.has(key)) return null
  inFlight.add(key)
  try {
    const settings = getSettings()
    if (settings.titleProvider === 'none') return null
    const apiKey = resolveApiKey(settings.apiKey)
    if (!apiKey) return null

    const context = latestPrompt && latestPrompt !== firstPrompt
      ? `Opening message: "${firstPrompt.slice(0, 400)}"\nLatest message: "${latestPrompt.slice(0, 300)}"`
      : `"${firstPrompt.slice(0, 700)}"`
    const prompt = `Write a 1-2 sentence summary of what was worked on in this conversation: ${context}. Be concise and factual. Reply with only the summary.`

    const model = settings.titleProvider === 'anthropic'
      ? createAnthropic({ apiKey })(settings.model || 'claude-haiku-4-5-20251001')
      : createOpenAI({ apiKey, baseURL: settings.baseUrl, compatibility: 'compatible' }).chat(settings.model)

    const { text } = await generateText({ model, prompt, maxTokens: 80 })
    const raw = text.trim().replace(/^["']|["']$/g, '').slice(0, 300)
    if (!raw) return null

    loadCache()
    memCache[key] = { title: raw, generatedAt: Date.now() }
    saveCache()
    return raw
  } catch (err) {
    console.error('[titleManager] summary generation failed:', err)
    return null
  } finally {
    inFlight.delete(key)
  }
}

export async function generateTitle(
  sessionId: string, firstPrompt: string, latestPrompt?: string
): Promise<string | null> {
  const cached = getCachedTitle(sessionId)
  if (cached) return cached
  if (inFlight.has(sessionId)) return null
  inFlight.add(sessionId)
  try {
    const settings = getSettings()
    if (settings.titleProvider === 'none') return null
    const apiKey = resolveApiKey(settings.apiKey)
    if (!apiKey) return null

    const context = latestPrompt && latestPrompt !== firstPrompt
      ? `Opening message: "${firstPrompt.slice(0, 300)}"\nLatest message: "${latestPrompt.slice(0, 200)}"`
      : `"${firstPrompt.slice(0, 500)}"`
    const prompt = `Generate a title (5 words or less, no punctuation, no quotes) for this conversation: ${context}. Reply with only the title.`

    const model = settings.titleProvider === 'anthropic'
      ? createAnthropic({ apiKey })(settings.model || 'claude-haiku-4-5-20251001')
      : createOpenAI({ apiKey, baseURL: settings.baseUrl, compatibility: 'compatible' }).chat(settings.model)

    const { text } = await generateText({ model, prompt, maxTokens: 20 })
    const raw = text.trim().replace(/^["']|["']$/g, '').slice(0, 60)
    if (!raw) return null

    loadCache()
    memCache[sessionId] = { title: raw, generatedAt: Date.now() }
    saveCache()
    return raw
  } catch (err) {
    console.error('[titleManager] generation failed:', err)
    return null
  } finally {
    inFlight.delete(sessionId)
  }
}
