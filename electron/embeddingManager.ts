import fs from 'fs'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'
import { embed, embedMany, cosineSimilarity } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { getSettings } from './settingsManager'
import type { ClaudeSession } from './sessionManager'

const DB_PATH = path.join(os.homedir(), '.claude', 'claudesole-embeddings.db')

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      session_id   TEXT PRIMARY KEY,
      embedding    BLOB NOT NULL,
      content_hash TEXT NOT NULL,
      embedded_at  INTEGER NOT NULL
    )
  `)
  return db
}

function getEntry(sessionId: string): { embedding: number[]; contentHash: string } | null {
  const row = getDb()
    .prepare('SELECT embedding, content_hash FROM embeddings WHERE session_id = ?')
    .get(sessionId) as { embedding: Buffer; content_hash: string } | undefined
  if (!row) return null
  return {
    embedding: Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)),
    contentHash: row.content_hash,
  }
}

function upsertEntry(sessionId: string, embedding: number[], contentHash: string): void {
  const arr = new Float32Array(embedding)
  const buf = Buffer.from(arr.buffer)
  getDb()
    .prepare('INSERT OR REPLACE INTO embeddings (session_id, embedding, content_hash, embedded_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, buf, contentHash, Date.now())
}

function shortHash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

function buildEmbedText(s: ClaudeSession): string {
  return [
    s.title,
    s.projectName,
    s.firstPrompt?.slice(0, 400),
    s.latestPrompt !== s.firstPrompt ? s.latestPrompt?.slice(0, 200) : undefined,
    s.summary?.slice(0, 300),
    s.slug,
  ].filter(Boolean).join(' | ')
}

function resolveEmbeddingModel() {
  const settings = getSettings()
  let apiKey = settings.titleProvider === 'openai-compatible' ? settings.apiKey : null
  if (!apiKey) apiKey = process.env.OPENAI_API_KEY ?? null
  if (!apiKey) return null
  const baseURL = settings.baseUrl || undefined
  return createOpenAI({ apiKey, baseURL, compatibility: 'compatible' }).embedding('text-embedding-3-small')
}

const inFlight = new Set<string>()

export async function ensureEmbeddings(sessions: ClaudeSession[]): Promise<void> {
  const model = resolveEmbeddingModel()
  if (!model) return

  const stale = sessions.filter(s => {
    const text = buildEmbedText(s)
    if (!text) return false
    if (inFlight.has(s.sessionId)) return false
    const entry = getEntry(s.sessionId)
    if (!entry) return true
    return entry.contentHash !== shortHash(text)
  })

  if (stale.length === 0) return

  stale.forEach(s => inFlight.add(s.sessionId))

  try {
    const CHUNK = 50
    for (let i = 0; i < stale.length; i += CHUNK) {
      const batch = stale.slice(i, i + CHUNK)
      const texts = batch.map(s => buildEmbedText(s))
      const { embeddings } = await embedMany({ model, values: texts, maxRetries: 1 })
      for (let j = 0; j < batch.length; j++) {
        upsertEntry(batch[j].sessionId, embeddings[j], shortHash(texts[j]))
      }
    }
  } catch (err) {
    console.error('[embeddingManager] batch embedding failed:', err)
  } finally {
    stale.forEach(s => inFlight.delete(s.sessionId))
  }
}

export async function semanticSearch(
  query: string,
  sessions: ClaudeSession[],
  topK = 20,
): Promise<Array<{ session: ClaudeSession; score: number }>> {
  const model = resolveEmbeddingModel()
  if (!model) return []

  let queryEmbedding: number[]
  try {
    const { embedding } = await embed({ model, value: query, maxRetries: 1 })
    queryEmbedding = embedding
  } catch (err) {
    console.error('[embeddingManager] query embedding failed:', err)
    return []
  }

  const sessionIds = sessions.map(s => s.sessionId)
  const placeholders = sessionIds.map(() => '?').join(',')
  const rows = getDb()
    .prepare(`SELECT session_id, embedding FROM embeddings WHERE session_id IN (${placeholders})`)
    .all(...sessionIds) as Array<{ session_id: string; embedding: Buffer }>

  const sessionMap = new Map(sessions.map(s => [s.sessionId, s]))
  const results: Array<{ session: ClaudeSession; score: number }> = []

  for (const row of rows) {
    const session = sessionMap.get(row.session_id)
    if (!session) continue
    const vec = Array.from(new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4))
    const score = cosineSimilarity(queryEmbedding, vec)
    results.push({ session, score })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK)
}

export function getIndexedCount(): number {
  try {
    const row = getDb().prepare('SELECT COUNT(*) as cnt FROM embeddings').get() as { cnt: number }
    return row.cnt
  } catch {
    return 0
  }
}

export function isEmbeddingAvailable(): boolean {
  return resolveEmbeddingModel() !== null
}
