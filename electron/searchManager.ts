import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'

export type SearchSource = 'claude' | 'codex'

export interface SessionSearchHit {
  source: SearchSource
  sessionId: string
  snippet: string
}

function dbPath(): string {
  return process.env.CLAUDESOLE_SEARCH_DB ?? path.join(os.homedir(), '.claude', 'claudesole-search.db')
}

let db: Database.Database | null = null

export function __resetDbForTests(): void {
  try { db?.close() } catch {}
  db = null
}

function getDb(): Database.Database {
  if (db) return db
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_search_meta (
      source    TEXT NOT NULL,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mtime_ms  INTEGER NOT NULL,
      file_size INTEGER NOT NULL,
      PRIMARY KEY (source, session_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
      source UNINDEXED,
      session_id UNINDEXED,
      project_name,
      slug,
      cwd,
      content,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `)
  return db
}

function safeDirEntries(dirPath: string): fs.Dirent[] {
  try { return fs.readdirSync(dirPath, { withFileTypes: true }) } catch { return [] }
}

export function extractClaudeText(content: unknown): string[] {
  if (typeof content === 'string') {
    const text = content.trim()
    return text && !text.startsWith('<') ? [text] : []
  }
  if (!Array.isArray(content)) return []
  const texts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if ((block as { type?: string }).type !== 'text') continue
    const text = String((block as { text?: unknown }).text || '').trim()
    if (text && !text.startsWith('<')) texts.push(text)
  }
  return texts
}

export function extractCodexContent(content: unknown): string[] {
  if (typeof content === 'string') {
    const text = content.trim()
    return text && !text.startsWith('<') ? [text] : []
  }
  if (!Array.isArray(content)) return []
  const texts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const type = String((block as { type?: unknown }).type || '')
    if (!type.endsWith('_text') && type !== 'text') continue
    const text = String((block as { text?: unknown }).text || '').trim()
    if (text && !text.startsWith('<')) texts.push(text)
  }
  return texts
}

export function parseClaudeTranscript(filePath: string): { cwd: string; slug: string; projectName: string; content: string } | null {
  let cwd = ''
  let slug = ''
  const chunks: string[] = []

  try {
    for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
        if (!slug && typeof obj.slug === 'string') slug = obj.slug
        if (obj.type === 'user' || obj.type === 'assistant') {
          chunks.push(...extractClaudeText(obj.message?.content))
        }
      } catch {}
    }
  } catch {
    return null
  }

  if (!cwd) return null
  return {
    cwd,
    slug,
    projectName: path.basename(cwd),
    content: chunks.join('\n\n'),
  }
}

export function parseCodexTranscript(filePath: string): { cwd: string; slug: string; projectName: string; content: string } | null {
  let cwd = ''
  let slug = ''
  const chunks: string[] = []

  try {
    for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (!cwd && obj.type === 'session_meta' && typeof obj.payload?.cwd === 'string') cwd = obj.payload.cwd
        if (!slug && obj.type === 'session_meta' && typeof obj.payload?.slug === 'string') slug = obj.payload.slug
        if (!cwd && obj.type === 'turn_context' && typeof obj.payload?.cwd === 'string') cwd = obj.payload.cwd

        if (obj.type === 'event_msg') {
          const eventType = String(obj.payload?.type || '')
          if (eventType === 'user_message' || eventType === 'assistant_message') {
            const text = String(obj.payload?.message || '').trim()
            if (text && !text.startsWith('<')) chunks.push(text)
          }
        }

        if (obj.type === 'response_item' && obj.payload?.type === 'message') {
          const role = String(obj.payload?.role || '')
          if (role === 'user' || role === 'assistant') {
            chunks.push(...extractCodexContent(obj.payload?.content))
          }
        }
      } catch {}
    }
  } catch {
    return null
  }

  if (!cwd) return null
  return {
    cwd,
    slug,
    projectName: path.basename(cwd),
    content: chunks.join('\n\n'),
  }
}

function upsertIndexedSession(source: SearchSource, sessionId: string, filePath: string, mtimeMs: number, fileSize: number): void {
  const parsed = source === 'claude' ? parseClaudeTranscript(filePath) : parseCodexTranscript(filePath)
  if (!parsed) return

  const database = getDb()
  database.prepare('DELETE FROM session_search WHERE source = ? AND session_id = ?').run(source, sessionId)
  database.prepare(`
    INSERT INTO session_search (source, session_id, project_name, slug, cwd, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(source, sessionId, parsed.projectName, parsed.slug, parsed.cwd, parsed.content)
  database.prepare(`
    INSERT INTO session_search_meta (source, session_id, file_path, mtime_ms, file_size)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source, session_id) DO UPDATE SET
      file_path = excluded.file_path,
      mtime_ms = excluded.mtime_ms,
      file_size = excluded.file_size
  `).run(source, sessionId, filePath, Math.trunc(mtimeMs), fileSize)
}

function syncSource(source: SearchSource): void {
  const activeKeys = new Set<string>()
  const database = getDb()
  const knownRows = database
    .prepare('SELECT session_id, mtime_ms, file_size FROM session_search_meta WHERE source = ?')
    .all(source) as Array<{ session_id: string; mtime_ms: number; file_size: number }>
  const known = new Map(knownRows.map(row => [row.session_id, row]))

  const visit = (sessionId: string, filePath: string) => {
    let stat: fs.Stats
    try { stat = fs.statSync(filePath) } catch { return }
    activeKeys.add(sessionId)
    const cached = known.get(sessionId)
    if (cached && cached.mtime_ms === Math.trunc(stat.mtimeMs) && cached.file_size === stat.size) return
    upsertIndexedSession(source, sessionId, filePath, stat.mtimeMs, stat.size)
  }

  if (source === 'claude') {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects')
    for (const project of safeDirEntries(projectsDir)) {
      if (!project.isDirectory()) continue
      const projectPath = path.join(projectsDir, project.name)
      for (const file of safeDirEntries(projectPath)) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
        visit(file.name.replace(/\.jsonl$/, ''), path.join(projectPath, file.name))
      }
    }
  } else {
    const sessionsDir = path.join(os.homedir(), '.codex', 'sessions')
    for (const year of safeDirEntries(sessionsDir)) {
      if (!year.isDirectory()) continue
      const yearPath = path.join(sessionsDir, year.name)
      for (const month of safeDirEntries(yearPath)) {
        if (!month.isDirectory()) continue
        const monthPath = path.join(yearPath, month.name)
        for (const day of safeDirEntries(monthPath)) {
          if (!day.isDirectory()) continue
          const dayPath = path.join(monthPath, day.name)
          for (const file of safeDirEntries(dayPath)) {
            if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
            visit(file.name.replace(/\.jsonl$/, ''), path.join(dayPath, file.name))
          }
        }
      }
    }
  }

  const stale = knownRows.filter(row => !activeKeys.has(row.session_id))
  const deleteMeta = database.prepare('DELETE FROM session_search_meta WHERE source = ? AND session_id = ?')
  const deleteFts = database.prepare('DELETE FROM session_search WHERE source = ? AND session_id = ?')
  for (const row of stale) {
    deleteMeta.run(source, row.session_id)
    deleteFts.run(source, row.session_id)
  }
}

export function buildFtsQuery(query: string): string | null {
  const terms = query.match(/[\p{L}\p{N}_-]+/gu) ?? []
  if (terms.length === 0) return null
  return terms.map(term => `${term.replace(/"/g, '""')}*`).join(' AND ')
}

export function fullTextSearchSessions(query: string, limit = 100): SessionSearchHit[] {
  const ftsQuery = buildFtsQuery(query)
  if (!ftsQuery) return []

  syncSource('claude')
  syncSource('codex')

  const rows = getDb().prepare(`
    SELECT
      source,
      session_id,
      snippet(session_search, 5, '[', ']', ' ... ', 18) AS snippet,
      bm25(session_search, 10.0, 6.0, 4.0, 1.0) AS rank
    FROM session_search
    WHERE session_search MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, limit) as Array<{ source: SearchSource; session_id: string; snippet: string | null }>

  return rows.map(row => ({
    source: row.source,
    sessionId: row.session_id,
    snippet: row.snippet || '',
  }))
}
