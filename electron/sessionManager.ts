import fs from 'fs'
import path from 'path'
import os from 'os'

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
    const fd = fs.openSync(filePath, 'r')

    // Read head for cwd / slug / firstPrompt
    const headBuf = Buffer.alloc(Math.min(HEAD, fileSize))
    const headN = fs.readSync(fd, headBuf, 0, headBuf.length, 0)
    fs.closeSync(fd)

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
          if (text) firstPrompt = text
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
        if (t) result.latestPrompt = t
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

export function listClaudeSessions(): ClaudeSession[] {
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

      sessions.push({
        sessionId: file.name.replace('.jsonl', ''),
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

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity)
}

export function latestSessionIdForCwd(cwd: string): string | null {
  const all = listClaudeSessions()
  return all.find(s => s.cwd === cwd)?.sessionId ?? null
}

export function getUsageForCwd(cwd: string): { tokensUsed?: number; model?: string } | null {
  const all = listClaudeSessions()
  const match = all.find(s => s.cwd === cwd)
  if (!match) return null
  return { tokensUsed: match.tokensUsed, model: match.model }
}
