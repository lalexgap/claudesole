import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import clsx from 'clsx'

const MIN_WIDTH = 180
const MAX_WIDTH = 480
const DRAG_MIME = 'application/x-claudesole-path'

interface Entry {
  name: string
  path: string
  isDir: boolean
  isHidden: boolean
}

interface Props {
  rootPath: string | null
  onClose: () => void
}

// POSIX shell single-quote escape — wraps in single quotes if any non-trivial char.
export function shellQuotePath(p: string): string {
  if (/^[A-Za-z0-9_\-./@:+,%=]+$/.test(p)) return p
  return `'${p.replace(/'/g, `'\\''`)}'`
}

interface WalkEntry { name: string; path: string; relPath: string }

export function FileBrowserPanel({ rootPath, onClose }: Props) {
  const [width, setWidth] = useState(260)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)
  const [showHidden, setShowHidden] = useState(false)
  const [query, setQuery] = useState('')
  const [walk, setWalk] = useState<{ entries: WalkEntry[]; truncated: boolean } | null>(null)
  const [walkLoading, setWalkLoading] = useState(false)
  const [walkError, setWalkError] = useState<string | null>(null)

  // (Re)load the flat file list when we need it for search.
  useEffect(() => {
    if (!rootPath) { setWalk(null); return }
    if (!query.trim()) return
    if (walk || walkLoading) return
    if (typeof window.electronAPI.walkDirectory !== 'function') {
      setWalkError('Restart the app to enable search')
      return
    }
    setWalkLoading(true)
    window.electronAPI.walkDirectory(rootPath, showHidden)
      .then(res => { setWalk({ entries: res.entries, truncated: res.truncated }); setWalkError(null) })
      .catch(err => setWalkError(err instanceof Error ? err.message : 'Failed to index files'))
      .finally(() => setWalkLoading(false))
  }, [rootPath, query, showHidden, walk, walkLoading])

  // Invalidate the walk cache when root or hidden-toggle changes.
  useEffect(() => { setWalk(null); setWalkError(null) }, [rootPath, showHidden])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const delta = ev.clientX - dragStartX.current
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta)))
    }
    const onMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [width])

  return (
    <div className="shrink-0 bg-app-850 border-r border-app-650 flex flex-col overflow-hidden relative" style={{ width }}>
      <div
        onMouseDown={onDragStart}
        className="absolute top-0 right-0 w-[4px] h-full cursor-col-resize z-10 hover:bg-white/[0.08] transition-colors"
      />
      <div className="px-2 py-1.5 border-b border-app-700 flex items-center gap-1.5 shrink-0">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setQuery('') } }}
          placeholder="Search files…"
          className="flex-1 min-w-0 bg-app-750 border border-app-500 focus:border-app-350 outline-none rounded px-2 py-[3px] text-[12px] text-neutral-200 placeholder:text-[#555]"
        />
        <button
          onClick={() => setShowHidden(v => !v)}
          title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
          className={clsx(
            'text-[10px] leading-none px-1.5 py-0.5 rounded border shrink-0',
            showHidden ? 'text-neutral-200 bg-white/[0.06] border-app-400' : 'text-[#666] bg-transparent border-app-500 hover:text-[#aaa]'
          )}
        >
          .*
        </button>
        <button
          onClick={onClose}
          title="Close (⌘E)"
          className="text-[#666] hover:text-neutral-200 text-sm leading-none px-1 shrink-0"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {!rootPath
          ? <div className="px-3 py-4 text-[#555] text-xs">No active session</div>
          : query.trim()
            ? <SearchResults
                query={query.trim()}
                walk={walk}
                loading={walkLoading}
                error={walkError}
              />
            : <DirNode path={rootPath} depth={0} initiallyOpen showHidden={showHidden} label={rootPath} />}
      </div>

      <div className="shrink-0 border-t border-app-700 px-3 py-1.5 text-[#555] text-[10px] leading-tight">
        Drag a file into a terminal to insert its path.
      </div>
    </div>
  )
}

interface NodeProps {
  path: string
  depth: number
  initiallyOpen?: boolean
  showHidden: boolean
  label?: string
}

function DirNode({ path, depth, initiallyOpen, showHidden, label }: NodeProps) {
  const [open, setOpen] = useState(!!initiallyOpen)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || entries !== null || loading) return
    if (typeof window.electronAPI.listDirectory !== 'function') {
      setError('Restart the app to enable the file browser')
      return
    }
    setLoading(true)
    window.electronAPI.listDirectory(path)
      .then(es => { setEntries(es); setError(null) })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to read'))
      .finally(() => setLoading(false))
  }, [open, path, entries, loading])

  const display = label ?? path.split('/').pop() ?? path
  const visible = entries?.filter(e => showHidden || !e.isHidden) ?? []

  return (
    <div>
      <Row
        depth={depth}
        isDir
        open={open}
        name={display}
        path={path}
        onClick={() => setOpen(v => !v)}
      />
      {open && (
        <div>
          {loading && <div style={{ paddingLeft: indent(depth + 1) }} className="text-[#555] text-[10px] py-0.5">Loading…</div>}
          {error && <div style={{ paddingLeft: indent(depth + 1) }} className="text-red-400/80 text-[10px] py-0.5">{error}</div>}
          {visible.map(e => e.isDir
            ? <DirNode key={e.path} path={e.path} depth={depth + 1} showHidden={showHidden} />
            : <FileRow key={e.path} entry={e} depth={depth + 1} />)}
        </div>
      )}
    </div>
  )
}

function FileRow({ entry, depth }: { entry: Entry; depth: number }) {
  return <Row depth={depth} isDir={false} name={entry.name} path={entry.path} />
}

function Row({ depth, isDir, open, name, path, onClick }: {
  depth: number
  isDir: boolean
  open?: boolean
  name: string
  path: string
  onClick?: () => void
}) {
  const handleDragStart = (e: React.DragEvent) => {
    const quoted = shellQuotePath(path) + ' '
    e.dataTransfer.setData('text/plain', quoted)
    e.dataTransfer.setData(DRAG_MIME, path)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onClick}
      style={{ paddingLeft: indent(depth) }}
      className={clsx(
        'flex items-center gap-1.5 pr-2 py-[2px] cursor-pointer text-[12px] hover:bg-white/[0.04] select-none',
        isDir ? 'text-[#bbb]' : 'text-[#888]'
      )}
      title={path}
    >
      <span className="text-[9px] text-[#555] w-2 shrink-0 leading-none">
        {isDir ? (open ? '▾' : '▸') : ''}
      </span>
      <span className="shrink-0 text-[#666] flex items-center">
        {isDir ? <FolderIcon /> : <FileIcon />}
      </span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
    </div>
  )
}

const MAX_RESULTS = 200

interface Match {
  entry: WalkEntry
  score: number
  indices: number[] // indices into entry.relPath
}

function SearchResults({ query, walk, loading, error }: {
  query: string
  walk: { entries: WalkEntry[]; truncated: boolean } | null
  loading: boolean
  error: string | null
}) {
  const matches = useMemo<Match[]>(() => {
    if (!walk) return []
    const results: Match[] = []
    for (const entry of walk.entries) {
      const m = fuzzyScore(query, entry.relPath)
      if (m) results.push({ entry, ...m })
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, MAX_RESULTS)
  }, [query, walk])

  if (loading) return <div className="px-3 py-2 text-[#666] text-[11px]">Indexing…</div>
  if (error) return <div className="px-3 py-2 text-red-400/80 text-[11px]">{error}</div>
  if (!walk) return null
  if (matches.length === 0) return <div className="px-3 py-2 text-[#555] text-[11px]">No matches</div>

  return (
    <div>
      {matches.map(m => <SearchResultRow key={m.entry.path} match={m} />)}
      {walk.truncated && (
        <div className="px-3 py-1.5 text-[#555] text-[10px] italic border-t border-app-700 mt-1">
          Index truncated — not all files searched.
        </div>
      )}
    </div>
  )
}

function SearchResultRow({ match }: { match: Match }) {
  const { entry, indices } = match
  const handleDragStart = (e: React.DragEvent) => {
    const quoted = shellQuotePath(entry.path) + ' '
    e.dataTransfer.setData('text/plain', quoted)
    e.dataTransfer.setData(DRAG_MIME, entry.path)
    e.dataTransfer.effectAllowed = 'copy'
  }

  // Split basename vs parent dir for display
  const slash = entry.relPath.lastIndexOf('/')
  const parentLen = slash < 0 ? 0 : slash + 1
  const parent = slash < 0 ? '' : entry.relPath.slice(0, slash)
  const basename = slash < 0 ? entry.relPath : entry.relPath.slice(slash + 1)

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="flex flex-col px-2 py-[3px] cursor-grab hover:bg-white/[0.04] select-none"
      title={entry.path}
    >
      <div className="flex items-center gap-1.5 text-[12px] text-[#ccc]">
        <span className="shrink-0 text-[#666] flex items-center"><FileIcon /></span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {renderHighlighted(basename, indices, parentLen)}
        </span>
      </div>
      {parent && (
        <div className="text-[10px] text-[#555] pl-[18px] overflow-hidden text-ellipsis whitespace-nowrap">
          {renderHighlighted(parent, indices, 0)}
        </div>
      )}
    </div>
  )
}

// Render string with matched char indices highlighted. `offset` is subtracted
// from each index (so a basename can reuse indices from the full relPath).
function renderHighlighted(str: string, indices: number[], offset: number) {
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < str.length; i++) {
    const globalIdx = i + offset
    if (indices.includes(globalIdx)) {
      if (cursor < i) nodes.push(str.slice(cursor, i))
      nodes.push(<span key={i} className="text-gold font-semibold">{str[i]}</span>)
      cursor = i + 1
    }
  }
  if (cursor < str.length) nodes.push(str.slice(cursor))
  return nodes
}

// Subsequence fuzzy match. Returns score + matched indices, or null.
// Scoring (roughly VS Code-flavored):
//   +1  base per matched char
//   +3  consecutive match
//   +4  match at path boundary (start or after / . - _ space)
//   +8  match on a basename character
//   −0.05 per unmatched char in the path (shorter paths preferred)
function fuzzyScore(query: string, target: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const slash = target.lastIndexOf('/')
  const baseStart = slash + 1
  const indices: number[] = []
  let ti = 0
  let score = 0
  let prevMatch = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    while (ti < t.length && t[ti] !== ch) ti++
    if (ti >= t.length) return null
    indices.push(ti)
    score += 1
    if (ti === prevMatch + 1) score += 3
    if (ti === 0 || /[\/\-_.\s]/.test(target[ti - 1])) score += 4
    if (ti >= baseStart) score += 8
    prevMatch = ti
    ti++
  }
  score -= target.length * 0.05
  return { score, indices }
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 1.75h6.5L13 5.25v9A0.75 0.75 0 0 1 12.25 15h-9.5A0.75 0.75 0 0 1 2 14.25V2.5A0.75 0.75 0 0 1 2.75 1.75z" />
      <path d="M9.25 2v3.25h3.25" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4a1 1 0 0 1 1-1h3.5l1.5 1.75H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" />
    </svg>
  )
}

function indent(depth: number): number {
  return 8 + depth * 12
}

export const FILE_DRAG_MIME = DRAG_MIME
