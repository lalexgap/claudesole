import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFile, findTailData } from './sessionManager'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-session-'))
})

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

function writeFixture(lines: unknown[]): { path: string; size: number } {
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n'
  const p = path.join(tmpDir, 'session.jsonl')
  fs.writeFileSync(p, content)
  return { path: p, size: fs.statSync(p).size }
}

describe('parseFile (head)', () => {
  it('extracts cwd, slug, and firstPrompt from the head', () => {
    const { path: p, size } = writeFixture([
      { cwd: '/x/y', slug: 'session-slug', type: 'meta' },
      { type: 'user', message: { content: 'Hello!' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10 } } },
    ])
    const out = parseFile(p, size)
    expect(out.cwd).toBe('/x/y')
    expect(out.slug).toBe('session-slug')
    expect(out.firstPrompt).toBe('Hello!')
  })

  it("skips user messages whose text starts with '<'", () => {
    const { path: p, size } = writeFixture([
      { cwd: '/x', slug: 's' },
      { type: 'user', message: { content: '<system-reminder>injected</system-reminder>' } },
      { type: 'user', message: { content: 'real prompt' } },
    ])
    expect(parseFile(p, size).firstPrompt).toBe('real prompt')
  })

  it('handles array-form user content', () => {
    const { path: p, size } = writeFixture([
      { cwd: '/x', slug: 's' },
      { type: 'user', message: { content: [{ type: 'text', text: 'array-form prompt' }] } },
    ])
    expect(parseFile(p, size).firstPrompt).toBe('array-form prompt')
  })

  it('captures a recap from the head of a forked session', () => {
    // Forks emit the previous-session summary as the very first line; the head
    // scan should capture it even when no summary appears later.
    const { path: p, size } = writeFixture([
      { type: 'summary', summary: 'Carried-over context from prior session', leafUuid: 'abc' },
      { cwd: '/x', slug: 's' },
      { type: 'user', message: { content: 'continuing the work' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1 } } },
    ])
    expect(parseFile(p, size).recap).toBe('Carried-over context from prior session')
  })

  it('does not throw on an empty file', () => {
    const p = path.join(tmpDir, 'empty.jsonl')
    fs.writeFileSync(p, '')
    expect(() => parseFile(p, 0)).not.toThrow()
    expect(parseFile(p, 0).cwd).toBeUndefined()
  })
})

describe('findTailData', () => {
  it('finds the latest user prompt via reverse scan', () => {
    const { path: p, size } = writeFixture([
      { cwd: '/x', slug: 's' },
      { type: 'user', message: { content: 'first prompt' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1 } } },
      { type: 'user', message: { content: 'most recent prompt' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }], model: 'claude-haiku', usage: { input_tokens: 5, cache_creation_input_tokens: 7, cache_read_input_tokens: 11 } } },
    ])
    const tail = findTailData(p, size)
    expect(tail.latestPrompt).toBe('most recent prompt')
    // Most recent assistant block → 5 + 7 + 11 = 23
    expect(tail.tokensUsed).toBe(23)
    expect(tail.model).toBe('claude-haiku')
  })

  it('sums input + cache_creation + cache_read tokens with missing fields defaulting to 0', () => {
    const { path: p, size } = writeFixture([
      { cwd: '/x', slug: 's' },
      { type: 'user', message: { content: 'x' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 42 } } },
    ])
    expect(findTailData(p, size).tokensUsed).toBe(42)
  })

  it('captures the latest CLI-emitted recap (summary record)', () => {
    const { path: p, size } = writeFixture([
      { cwd: '/x', slug: 's' },
      { type: 'user', message: { content: 'first prompt' } },
      { type: 'summary', summary: 'older recap', leafUuid: 'a' },
      { type: 'user', message: { content: 'mid prompt' } },
      { type: 'summary', summary: 'latest recap', leafUuid: 'b' },
      { type: 'user', message: { content: 'most recent prompt' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1 } } },
    ])
    expect(findTailData(p, size).recap).toBe('latest recap')
  })

  it('returns recap=undefined when no summary records exist', () => {
    const { path: p, size } = writeFixture([
      { cwd: '/x', slug: 's' },
      { type: 'user', message: { content: 'hi' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1 } } },
    ])
    expect(findTailData(p, size).recap).toBeUndefined()
  })

  it('survives a multi-byte UTF-8 character near the chunk boundary', () => {
    const head = { cwd: '/x', slug: 's' }
    // Build a long user message whose multi-byte char ends up near a 32KB boundary.
    const pad = '日'.repeat(20_000) // 20k * 3 bytes = 60k bytes > CHUNK (32k)
    const { path: p, size } = writeFixture([
      head,
      { type: 'user', message: { content: `start ${pad} end` } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'reply' }], usage: { input_tokens: 1 } } },
    ])
    const tail = findTailData(p, size)
    expect(tail.latestPrompt).toBeDefined()
    // Start and end must both survive a clean UTF-8 decode.
    expect(tail.latestPrompt!.startsWith('start ')).toBe(true)
    expect(tail.latestPrompt!.endsWith(' end')).toBe(true)
  })
})
