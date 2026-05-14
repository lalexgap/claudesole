import { useState, useEffect, useRef, useMemo } from 'react'
import clsx from 'clsx'
import { fuzzyScore } from './FileBrowserPanel'

interface Props {
  rootPath: string | null
  onPick: (filePath: string) => void
  onClose: () => void
}

interface WalkEntry { name: string; path: string; relPath: string }

interface Match { entry: WalkEntry; score: number; indices: number[] }

const MAX_RESULTS = 50
const CACHE_TTL_MS = 30_000

// Module-scoped cache so reopening ⌘P doesn't re-walk on every invocation.
const indexCache = new Map<string, { fetchedAt: number; entries: WalkEntry[]; truncated: boolean }>()

export function QuickOpenModal({ rootPath, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const [entries, setEntries] = useState<WalkEntry[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!rootPath) { setEntries([]); return }
    const cached = indexCache.get(rootPath)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setEntries(cached.entries)
      setTruncated(cached.truncated)
      return
    }
    setLoading(true)
    setError(null)
    window.electronAPI.walkDirectory(rootPath, false)
      .then(res => {
        indexCache.set(rootPath, { fetchedAt: Date.now(), entries: res.entries, truncated: res.truncated })
        setEntries(res.entries)
        setTruncated(res.truncated)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to index files'))
      .finally(() => setLoading(false))
  }, [rootPath])

  const matches = useMemo<Match[]>(() => {
    if (!entries) return []
    const q = query.trim()
    if (!q) {
      // No query → show first N entries as a starting set.
      return entries.slice(0, MAX_RESULTS).map(entry => ({ entry, score: 0, indices: [] }))
    }
    const results: Match[] = []
    for (const entry of entries) {
      const m = fuzzyScore(q, entry.relPath)
      if (m) results.push({ entry, ...m })
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, MAX_RESULTS)
  }, [entries, query])

  useEffect(() => { setIdx(0) }, [query])

  const commit = (m: Match) => { onPick(m.entry.path); onClose() }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, matches.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && matches[idx]) { e.preventDefault(); commit(matches[idx]) }
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-20 bg-black/55"
      onClick={onClose}
    >
      <div
        className="bg-app-750 border border-app-400 rounded-[10px] w-[560px] max-h-[480px] shadow-[0_16px_48px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder={rootPath ? 'Open file…' : 'No active session'}
          disabled={!rootPath}
          className="bg-transparent border-0 border-b border-app-500 outline-none text-neutral-200 text-sm px-4 py-3.5"
        />

        <div className="overflow-y-auto">
          {loading && <div className="px-4 py-3 text-[#666] text-[11px]">Indexing…</div>}
          {error && <div className="px-4 py-3 text-red-400/80 text-[11px]">{error}</div>}
          {!loading && !error && entries && matches.length === 0 && (
            <div className="px-4 py-5 text-[#555] text-[13px] text-center">No matches</div>
          )}
          {matches.map((m, i) => {
            const slash = m.entry.relPath.lastIndexOf('/')
            const parent = slash < 0 ? '' : m.entry.relPath.slice(0, slash)
            const basename = slash < 0 ? m.entry.relPath : m.entry.relPath.slice(slash + 1)
            return (
              <div
                key={m.entry.path}
                onClick={() => commit(m)}
                onMouseEnter={() => setIdx(i)}
                className={clsx(
                  'flex flex-col gap-px px-4 py-[8px] cursor-pointer border-l-2',
                  i === idx ? 'bg-white/[0.07] border-amber-400' : 'bg-transparent border-transparent'
                )}
              >
                <div className="text-[13px] text-[#ddd] overflow-hidden text-ellipsis whitespace-nowrap">
                  {renderHighlighted(basename, m.indices, slash < 0 ? 0 : slash + 1)}
                </div>
                {parent && (
                  <div className="text-[10px] text-[#666] overflow-hidden text-ellipsis whitespace-nowrap">
                    {renderHighlighted(parent, m.indices, 0)}
                  </div>
                )}
              </div>
            )
          })}
          {truncated && (
            <div className="px-4 py-1.5 text-[#555] text-[10px] italic border-t border-app-700">
              Index truncated — not all files searched.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function renderHighlighted(str: string, indices: number[], offset: number) {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < str.length; i++) {
    const globalIdx = i + offset
    if (indices.includes(globalIdx)) {
      if (cursor < i) nodes.push(str.slice(cursor, i))
      nodes.push(<span key={i} className="text-amber-300 font-semibold">{str[i]}</span>)
      cursor = i + 1
    }
  }
  if (cursor < str.length) nodes.push(str.slice(cursor))
  return nodes
}
