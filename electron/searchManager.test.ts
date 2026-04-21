import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildFtsQuery,
  extractClaudeText,
  extractCodexContent,
  parseClaudeTranscript,
  parseCodexTranscript,
} from './searchManager'

const __dirname_local = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(__dirname_local, '__fixtures__')

function hasBetterSqlite(): boolean {
  try {
    const req = createRequire(import.meta.url)
    const Database = req('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    return false
  }
}

const nativeAvailable = hasBetterSqlite()

describe('buildFtsQuery', () => {
  it('returns null for an empty string', () => {
    expect(buildFtsQuery('')).toBeNull()
  })

  it('returns null for whitespace or punctuation-only input', () => {
    expect(buildFtsQuery('   ')).toBeNull()
    expect(buildFtsQuery('?!.')).toBeNull()
  })

  it("wraps a single token with a prefix glob: 'foo' -> 'foo*'", () => {
    expect(buildFtsQuery('foo')).toBe('foo*')
  })

  it("joins multiple tokens with AND: 'foo bar' -> 'foo* AND bar*'", () => {
    expect(buildFtsQuery('foo bar')).toBe('foo* AND bar*')
  })

  it('preserves unicode letters', () => {
    expect(buildFtsQuery('café')).toBe('café*')
  })

  it('preserves digits and treats punctuation as separators', () => {
    expect(buildFtsQuery('fix bug 123')).toBe('fix* AND bug* AND 123*')
  })

  it('keeps hyphens and underscores inside a single token', () => {
    expect(buildFtsQuery('snake_case-thing')).toBe('snake_case-thing*')
  })
})

describe('extractClaudeText', () => {
  it('returns a non-empty string verbatim when not tag-prefixed', () => {
    expect(extractClaudeText('hello world')).toEqual(['hello world'])
  })

  it("filters out '<'-prefixed system-injected strings", () => {
    expect(extractClaudeText('<system-reminder>ignore</system-reminder>')).toEqual([])
  })

  it("extracts only type='text' blocks from an array", () => {
    const content = [
      { type: 'text', text: 'keep me' },
      { type: 'tool_use', name: 'Bash', input: {} },
      { type: 'text', text: '<system>drop me</system>' },
      { type: 'text', text: 'keep me too' },
    ]
    expect(extractClaudeText(content)).toEqual(['keep me', 'keep me too'])
  })

  it('returns [] for null, undefined, or numbers', () => {
    expect(extractClaudeText(null)).toEqual([])
    expect(extractClaudeText(undefined)).toEqual([])
    expect(extractClaudeText(42 as unknown)).toEqual([])
  })
})

describe('extractCodexContent', () => {
  it("accepts 'text', 'input_text', and 'output_text' block types", () => {
    const content = [
      { type: 'text', text: 'a' },
      { type: 'input_text', text: 'b' },
      { type: 'output_text', text: 'c' },
      { type: 'image', data: '…' },
    ]
    expect(extractCodexContent(content)).toEqual(['a', 'b', 'c'])
  })

  it("filters '<'-prefixed text", () => {
    expect(extractCodexContent('<meta>drop</meta>')).toEqual([])
    expect(extractCodexContent([{ type: 'output_text', text: '<sys>drop</sys>' }])).toEqual([])
  })
})

describe('parseClaudeTranscript', () => {
  it('extracts cwd, slug, and joined user/assistant content from the fixture', () => {
    const parsed = parseClaudeTranscript(path.join(FIXTURES, 'claude-sample.jsonl'))
    expect(parsed).not.toBeNull()
    expect(parsed!.cwd).toBe('/Users/test/repo')
    expect(parsed!.slug).toBe('claude-sample-slug')
    expect(parsed!.projectName).toBe('repo')
    // Joined user+assistant content, skipping the '<'-prefixed system reminder.
    expect(parsed!.content).toContain('Hello, can you help me refactor this function?')
    expect(parsed!.content).toContain("Sure — let's look at the function.")
    expect(parsed!.content).toContain("Here's a follow-up question about the refactor.")
    expect(parsed!.content).not.toContain('<system-reminder>injected context</system-reminder>')
  })

  it('returns null when the file has no cwd', () => {
    expect(parseClaudeTranscript(path.join(FIXTURES, 'claude-no-cwd.jsonl'))).toBeNull()
  })

  it('returns null when the file does not exist', () => {
    expect(parseClaudeTranscript(path.join(FIXTURES, 'does-not-exist.jsonl'))).toBeNull()
  })
})

describe('parseCodexTranscript', () => {
  it('extracts cwd from session_meta when present', () => {
    const parsed = parseCodexTranscript(path.join(FIXTURES, 'codex-sample.jsonl'))
    expect(parsed).not.toBeNull()
    expect(parsed!.cwd).toBe('/Users/test/codex-repo')
    expect(parsed!.slug).toBe('codex-sample-slug')
    expect(parsed!.content).toContain('Codex: first user prompt')
    expect(parsed!.content).toContain('Codex: last user prompt')
    expect(parsed!.content).toContain('Codex assistant reply')
  })

  it('falls back to turn_context for cwd when no session_meta is present', () => {
    const parsed = parseCodexTranscript(path.join(FIXTURES, 'codex-turn-context-only.jsonl'))
    expect(parsed).not.toBeNull()
    expect(parsed!.cwd).toBe('/Users/test/codex-turn-ctx')
  })
})

describe.skipIf(!nativeAvailable)('fullTextSearchSessions (integration via :memory: db)', () => {
  let tmpHome: string
  let originalHome: string | undefined
  let originalSearchDb: string | undefined

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-search-'))
    originalHome = process.env.HOME
    originalSearchDb = process.env.CLAUDESOLE_SEARCH_DB
    process.env.HOME = tmpHome
    process.env.CLAUDESOLE_SEARCH_DB = ':memory:'
    const { __resetDbForTests } = await import('./searchManager')
    __resetDbForTests()
  })

  afterEach(async () => {
    const { __resetDbForTests } = await import('./searchManager')
    __resetDbForTests()
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalSearchDb === undefined) delete process.env.CLAUDESOLE_SEARCH_DB
    else process.env.CLAUDESOLE_SEARCH_DB = originalSearchDb
    try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {}
  })

  it('returns [] for an empty query', async () => {
    const { fullTextSearchSessions } = await import('./searchManager')
    expect(fullTextSearchSessions('')).toEqual([])
  })

  it('indexes an on-disk .claude/projects/*.jsonl and matches a known token', async () => {
    // Arrange: a synthetic Claude projects tree under $HOME
    const projDir = path.join(tmpHome, '.claude', 'projects', 'Users-test-repo')
    fs.mkdirSync(projDir, { recursive: true })
    const sid = 'aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa'
    fs.copyFileSync(
      path.join(FIXTURES, 'claude-sample.jsonl'),
      path.join(projDir, `${sid}.jsonl`),
    )

    const { fullTextSearchSessions } = await import('./searchManager')
    const hits = fullTextSearchSessions('refactor')
    expect(hits.length).toBeGreaterThan(0)
    const hit = hits.find(h => h.sessionId === sid)
    expect(hit).toBeTruthy()
    expect(hit!.source).toBe('claude')
  })
})
