import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getCachedTitle,
  getTitleCache,
  getCachedSummary,
  clearTitleCache,
  clearAllTitleCache,
  __resetCacheForTests,
} from './titleManager'

let tmpDir: string
let originalEnv: string | undefined

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-titles-'))
  originalEnv = process.env.CLAUDESOLE_TITLES_CACHE
  process.env.CLAUDESOLE_TITLES_CACHE = path.join(tmpDir, 'titles.json')
  __resetCacheForTests()
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env.CLAUDESOLE_TITLES_CACHE
  else process.env.CLAUDESOLE_TITLES_CACHE = originalEnv
  __resetCacheForTests()
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

function seedCache(entries: Record<string, { title: string; generatedAt: number }>) {
  fs.writeFileSync(process.env.CLAUDESOLE_TITLES_CACHE!, JSON.stringify(entries))
  // Force a fresh load from disk on the next access.
  __resetCacheForTests()
}

describe('getCachedTitle', () => {
  it('returns undefined when the cache file is missing', () => {
    expect(getCachedTitle('abc')).toBeUndefined()
  })

  it('returns the cached title when present', () => {
    seedCache({ abc: { title: 'Hello', generatedAt: 1 } })
    expect(getCachedTitle('abc')).toBe('Hello')
  })

  it('falls back to undefined for unknown ids', () => {
    seedCache({ abc: { title: 'Hello', generatedAt: 1 } })
    expect(getCachedTitle('missing')).toBeUndefined()
  })
})

describe('getTitleCache', () => {
  it('returns an { id: title } map', () => {
    seedCache({
      a: { title: 'T1', generatedAt: 1 },
      b: { title: 'T2', generatedAt: 2 },
    })
    expect(getTitleCache()).toEqual({ a: 'T1', b: 'T2' })
  })

  it('returns an empty object when no cache exists', () => {
    expect(getTitleCache()).toEqual({})
  })
})

describe('getCachedSummary', () => {
  it('reads the entry keyed at "<id>:summary"', () => {
    seedCache({
      abc: { title: 'short title', generatedAt: 1 },
      'abc:summary': { title: 'long summary text', generatedAt: 2 },
    })
    expect(getCachedSummary('abc')).toBe('long summary text')
  })

  it('returns undefined when no summary is stored', () => {
    seedCache({ abc: { title: 'title', generatedAt: 1 } })
    expect(getCachedSummary('abc')).toBeUndefined()
  })
})

describe('clearTitleCache', () => {
  it('removes both "<id>" and "<id>:summary" entries', () => {
    seedCache({
      abc: { title: 'title', generatedAt: 1 },
      'abc:summary': { title: 'summary', generatedAt: 2 },
      other: { title: 'untouched', generatedAt: 3 },
    })
    clearTitleCache('abc')

    // In-memory state
    expect(getCachedTitle('abc')).toBeUndefined()
    expect(getCachedSummary('abc')).toBeUndefined()
    expect(getCachedTitle('other')).toBe('untouched')

    // On-disk state
    const onDisk = JSON.parse(fs.readFileSync(process.env.CLAUDESOLE_TITLES_CACHE!, 'utf-8'))
    expect(Object.keys(onDisk).sort()).toEqual(['other'])
  })
})

describe('clearAllTitleCache', () => {
  it('empties the cache on disk and in memory', () => {
    seedCache({
      abc: { title: 'title', generatedAt: 1 },
      'abc:summary': { title: 'summary', generatedAt: 2 },
    })
    clearAllTitleCache()
    expect(getCachedTitle('abc')).toBeUndefined()
    const onDisk = JSON.parse(fs.readFileSync(process.env.CLAUDESOLE_TITLES_CACHE!, 'utf-8'))
    expect(onDisk).toEqual({})
  })
})
