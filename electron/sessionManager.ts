import fs from 'fs'
import path from 'path'
import os from 'os'
import { getTitleCache, getCachedSummary } from './titleManager'

export interface ClaudeSession {
  sessionId: string
  cwd: string
  projectName: string
  slug: string
  lastActivity: number // mtime ms
  firstPrompt: string
  latestPrompt: string
  tokensUsed?: number
  model?: string
  title?: string
  summary?: string
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as any).type === 'text') {
        const t = String((block as any).text || '').trim()
        if (t) return t
      }
    }
  }
  return ''
}

function parseFile(filePath: string, fileSize: number): { cwd?: string; slug?: string; firstPrompt?: string; latestPrompt?: string; tokensUsed?: number; model?: string } {
  try {
    const HEAD = 16384
    let headBuf: Buffer
    let headN: number
    const fd = fs.openSync(filePath, 'r')
    try {
      headBuf = Buffer.alloc(Math.min(HEAD, fileSize))
      headN = fs.readSync(fd, headBuf, 0, headBuf.length, 0)
    } finally {
      fs.closeSync(fd)
    }

    let cwd: string | undefined
    let slug: string | undefined
    let firstPrompt: string | undefined

    for (const line of headBuf.slice(0, headN).toString('utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (!cwd && obj.cwd) cwd = obj.cwd
        if (!slug && obj.slug) slug = obj.slug
        if (!firstPrompt && obj.type === 'user') {
          const text = extractText(obj.message?.content)
          // Skip system-injected messages (caveat notices, tool context) which are wrapped in XML tags
          if (text && !text.startsWith('<')) firstPrompt = text
        }
        if (cwd && slug && firstPrompt) break
      } catch {}
    }

    // Reverse-chunk scan for latest user message + token usage.
    const { latestPrompt, tokensUsed, model } = findTailData(filePath, fileSize)

    return { cwd, slug, firstPrompt, latestPrompt, tokensUsed, model }
  } catch {
    return {}
  }
}

interface TailData {
  latestPrompt?: string
  tokensUsed?: number
  model?: string
}

function findTailData(filePath: string, fileSize: number): TailData {
  const CHUNK = 32768
  let pos = fileSize
  let carry = ''
  const result: TailData = {}

  const done = () => result.latestPrompt !== undefined && result.tokensUsed !== undefined

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const obj = JSON.parse(trimmed)
      if (result.latestPrompt === undefined && obj.type === 'user') {
        const t = extractText(obj.message?.content)
        if (t && !t.startsWith('<')) result.latestPrompt = t
      }
      if (result.tokensUsed === undefined && obj.type === 'assistant') {
        const usage = obj.message?.usage
        if (usage?.input_tokens !== undefined) {
          // Total context = non-cached + cache writes + cache reads
          result.tokensUsed =
            (usage.input_tokens as number) +
            ((usage.cache_creation_input_tokens as number) || 0) +
            ((usage.cache_read_input_tokens as number) || 0)
          if (!result.model && obj.message?.model) result.model = obj.message.model as string
        }
      }
    } catch {}
  }

  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      while (pos > 0 && !done()) {
        const start = Math.max(0, pos - CHUNK)
        const size = pos - start
        const buf = Buffer.alloc(size)
        fs.readSync(fd, buf, 0, size, start)
        pos = start

        const text = buf.toString('utf-8') + carry
        const lines = text.split('\n')
        carry = lines[0]

        for (let i = lines.length - 1; i >= 1; i--) {
          processLine(lines[i])
          if (done()) break
        }
      }

      if (!done()) processLine(carry)
    } finally {
      fs.closeSync(fd)
    }
  } catch {}

  return result
}

let cachedSessions: ClaudeSession[] | null = null
let cacheExpiresAt = 0

export function invalidateSessionsCache(): void {
  cachedSessions = null
  cacheExpiresAt = 0
}

export function listClaudeSessions(): ClaudeSession[] {
  if (cachedSessions && Date.now() < cacheExpiresAt) return cachedSessions
  cachedSessions = _listClaudeSessions()
  cacheExpiresAt = Date.now() + 2000
  return cachedSessions
}

function _listClaudeSessions(): ClaudeSession[] {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(projectsDir)) return []

  const sessions: ClaudeSession[] = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirPath = path.join(projectsDir, entry.name)

    let files: fs.Dirent[]
    try {
      files = fs.readdirSync(dirPath, { withFileTypes: true })
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
      const filePath = path.join(dirPath, file.name)

      let mtime: number
      let fileSize: number
      try {
        const stat = fs.statSync(filePath)
        mtime = stat.mtimeMs
        fileSize = stat.size
      } catch {
        continue
      }

      const { cwd, slug, firstPrompt, latestPrompt, tokensUsed, model } = parseFile(filePath, fileSize)
      if (!cwd) continue

      const sessionId = file.name.replace('.jsonl', '')
      sessions.push({
        sessionId,
        cwd,
        projectName: path.basename(cwd),
        slug: slug || '',
        lastActivity: mtime,
        firstPrompt: firstPrompt || '',
        latestPrompt: latestPrompt || '',
        tokensUsed,
        model,
      })
    }
  }

  const titleCache = getTitleCache()
  for (const s of sessions) {
    if (titleCache[s.sessionId]) s.title = titleCache[s.sessionId]
    const summary = getCachedSummary(s.sessionId)
    if (summary) s.summary = summary
  }

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity)
}

export function buildSummaryContext(sessionId: string): string | null {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  let filePath: string | null = null
  let fileSize = 0
  try {
    for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const fp = path.join(projectsDir, entry.name, `${sessionId}.jsonl`)
      try { const st = fs.statSync(fp); filePath = fp; fileSize = st.size; break } catch {}
    }
  } catch { return null }
  if (!filePath) return null

  const messages: string[] = []
  try {
    const MAX_READ = 512 * 1024
    const buf = Buffer.alloc(Math.min(fileSize, MAX_READ))
    const fd = fs.openSync(filePath, 'r')
    try {
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      for (const line of buf.slice(0, n).toString('utf-8').split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          if (obj.type === 'user') {
            const text = extractText(obj.message?.content)
            if (text && !text.startsWith('<')) messages.push(text.slice(0, 300))
          }
        } catch {}
      }
    } finally { fs.closeSync(fd) }
  } catch { return null }

  if (messages.length === 0) return null

  // Sample up to 12 messages: first 4, middle 4, last 4 to cover the whole arc
  let sample: string[]
  if (messages.length <= 12) {
    sample = messages
  } else {
    const mid = Math.floor(messages.length / 2)
    sample = [...messages.slice(0, 4), ...messages.slice(mid - 2, mid + 2), ...messages.slice(-4)]
  }
  return sample.map((m, i) => `${i + 1}. ${m}`).join('\n')
}

export function latestSessionIdForCwd(cwd: string): string | null {
  const all = listClaudeSessions()
  return all.find(s => s.cwd === cwd)?.sessionId ?? null
}

export function latestSessionForCwd(cwd: string): ClaudeSession | null {
  const all = listClaudeSessions()
  return all.find(s => s.cwd === cwd) ?? null
}

export function sessionById(sessionId: string): ClaudeSession | null {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const fp = path.join(projectsDir, entry.name, `${sessionId}.jsonl`)
    let stat: fs.Stats
    try { stat = fs.statSync(fp) } catch { continue }
    const { cwd, slug, firstPrompt, latestPrompt, tokensUsed, model } = parseFile(fp, stat.size)
    if (!cwd) return null
    return {
      sessionId,
      cwd,
      projectName: path.basename(cwd),
      slug: slug || '',
      lastActivity: stat.mtimeMs,
      firstPrompt: firstPrompt || '',
      latestPrompt: latestPrompt || '',
      tokensUsed,
      model,
    }
  }
  return null
}

export interface CodexSession {
  sessionId: string
  cwd: string
  projectName: string
  slug: string
  lastActivity: number
  firstPrompt: string
  latestPrompt: string
  model?: string
  title?: string
}

let cachedCodexSessions: CodexSession[] | null = null
let codexCacheExpiresAt = 0

export function invalidateCodexSessionsCache(): void {
  cachedCodexSessions = null
  codexCacheExpiresAt = 0
}

export function listCodexSessions(): CodexSession[] {
  if (cachedCodexSessions && Date.now() < codexCacheExpiresAt) return cachedCodexSessions
  cachedCodexSessions = _listCodexSessions()
  codexCacheExpiresAt = Date.now() + 2000
  return cachedCodexSessions
}

function _listCodexSessions(): CodexSession[] {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions')
  if (!fs.existsSync(sessionsDir)) return []

  const sessions: CodexSession[] = []

  // Walk YYYY/MM/DD directory structure
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
          const filePath = path.join(dayPath, file.name)
          let mtime: number
          let fileSize: number
          try {
            const stat = fs.statSync(filePath)
            mtime = stat.mtimeMs
            fileSize = stat.size
          } catch { continue }
          const parsed = parseCodexFile(filePath, fileSize)
          if (!parsed.cwd) continue
          sessions.push({
            sessionId: parsed.sessionId || file.name.replace('.jsonl', ''),
            cwd: parsed.cwd,
            projectName: path.basename(parsed.cwd),
            slug: parsed.slug || '',
            lastActivity: mtime,
            firstPrompt: parsed.firstPrompt || '',
            latestPrompt: parsed.latestPrompt || '',
            model: parsed.model,
          })
        }
      }
    }
  }

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity)
}

function safeDirEntries(dirPath: string): fs.Dirent[] {
  try { return fs.readdirSync(dirPath, { withFileTypes: true }) } catch { return [] }
}

function parseCodexFile(filePath: string, fileSize: number): { sessionId?: string; cwd?: string; slug?: string; firstPrompt?: string; latestPrompt?: string; model?: string } {
  try {
    const HEAD = 16384
    const fd = fs.openSync(filePath, 'r')
    let headStr: string
    try {
      const headBuf = Buffer.alloc(Math.min(HEAD, fileSize))
      const n = fs.readSync(fd, headBuf, 0, headBuf.length, 0)
      headStr = headBuf.slice(0, n).toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }

    let sessionId: string | undefined
    let cwd: string | undefined
    let slug: string | undefined
    let firstPrompt: string | undefined

    for (const line of headStr.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (!sessionId && obj.type === 'session_meta' && obj.payload?.id) {
          sessionId = obj.payload.id
          if (!cwd && obj.payload.cwd) cwd = obj.payload.cwd
          if (!slug && obj.payload.slug) slug = obj.payload.slug
        }
        if (!cwd && obj.type === 'turn_context' && obj.payload?.cwd) cwd = obj.payload.cwd
        if (!firstPrompt && obj.type === 'event_msg' && obj.payload?.type === 'user_message') {
          const text = String(obj.payload.message || '').trim()
          if (text && !text.startsWith('<')) firstPrompt = text
        }
      } catch {}
      if (sessionId && cwd && firstPrompt) break
    }

    const { latestPrompt, model } = findCodexTailData(filePath, fileSize)
    return { sessionId, cwd, slug, firstPrompt, latestPrompt, model }
  } catch {
    return {}
  }
}

function findCodexTailData(filePath: string, fileSize: number): { latestPrompt?: string; model?: string } {
  const CHUNK = 32768
  let pos = fileSize
  let carry = ''
  let latestPrompt: string | undefined
  let model: string | undefined

  const done = () => latestPrompt !== undefined && model !== undefined

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const obj = JSON.parse(trimmed)
      if (latestPrompt === undefined && obj.type === 'event_msg' && obj.payload?.type === 'user_message') {
        const text = String(obj.payload.message || '').trim()
        if (text && !text.startsWith('<')) latestPrompt = text
      }
      if (model === undefined && obj.type === 'turn_context' && obj.payload?.model) {
        model = obj.payload.model
      }
    } catch {}
  }

  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      while (pos > 0 && !done()) {
        const start = Math.max(0, pos - CHUNK)
        const size = pos - start
        const buf = Buffer.alloc(size)
        fs.readSync(fd, buf, 0, size, start)
        pos = start
        const text = buf.toString('utf-8') + carry
        const lines = text.split('\n')
        carry = lines[0]
        for (let i = lines.length - 1; i >= 1; i--) {
          processLine(lines[i])
          if (done()) break
        }
      }
      if (!done()) processLine(carry)
    } finally {
      fs.closeSync(fd)
    }
  } catch {}

  return { latestPrompt, model }
}

export function getUsageForCwd(cwd: string): { tokensUsed?: number; model?: string } | null {
  const all = listClaudeSessions()
  const match = all.find(s => s.cwd === cwd)
  if (!match) return null
  return { tokensUsed: match.tokensUsed, model: match.model }
}
