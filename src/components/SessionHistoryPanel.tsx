import React, { useState, useEffect, useRef, useMemo } from 'react'
import clsx from 'clsx'
import { ClaudeSession, CodexSession } from '../types/ipc'
import { ContextBar } from './ContextBar'

type HistorySession =
  | (ClaudeSession & { source: 'claude' })
  | (CodexSession & { source: 'codex' })

interface Props {
  onResume: (session: HistorySession, skipPermissions: boolean) => void
  onFork: (session: HistorySession, skipPermissions: boolean) => void
  onClose: () => void
}

interface Group {
  label: string
  sessions: HistorySession[]
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

function groupSessions(sessions: HistorySession[]): Group[] {
  const now = Date.now()
  const day = 86_400_000
  const buckets: { label: string; min: number }[] = [
    { label: 'Today',        min: now - day },
    { label: 'Yesterday',    min: now - 2 * day },
    { label: 'Last 7 days',  min: now - 7 * day },
    { label: 'Last 30 days', min: now - 30 * day },
    { label: 'Older',        min: 0 },
  ]

  const groups: Group[] = []
  let remaining = [...sessions]

  for (const { label, min } of buckets) {
    const inBucket = remaining.filter(s => s.lastActivity > min)
    remaining = remaining.filter(s => s.lastActivity <= min)
    if (inBucket.length > 0) groups.push({ label, sessions: inBucket })
    if (remaining.length === 0) break
  }

  return groups
}

function loadFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem('claudesole:favorites')
    if (stored) return new Set(JSON.parse(stored))
  } catch {}
  return new Set()
}

export function SessionHistoryPanel({ onResume, onFork, onClose }: Props) {
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<HistorySession | null>(null)
  const [skipPermissions, setSkipPermissions] = useState(true)
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [gitInfo, setGitInfo] = useState<{ branch: string | null; isWorktree: boolean } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; session: HistorySession } | null>(null)
  const [searchMode, setSearchMode] = useState<'text' | 'semantic'>('text')
  const [semanticResults, setSemanticResults] = useState<Array<{ session: HistorySession; score: number }> | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [semanticAvailable, setSemanticAvailable] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    searchRef.current?.focus()
    let cancelled = false
    Promise.all([
      window.electronAPI.listSessions().catch(() => [] as ClaudeSession[]),
      window.electronAPI.listCodexSessions().catch(() => [] as CodexSession[]),
    ]).then(([claudeSessions, codexSessions]) => {
      if (cancelled) return
      const all = [
        ...claudeSessions.map(s => ({ ...s, source: 'claude' as const })),
        ...codexSessions.map(s => ({ ...s, source: 'codex' as const })),
      ].sort((a, b) => b.lastActivity - a.lastActivity)
      setSessions(all)
      // Generate titles for every uncached session, with bounded concurrency so
      // we don't fire hundreds of simultaneous AI calls.
      const uncached = all.filter(s => !s.title && (s.firstPrompt || s.latestPrompt))
      const CONCURRENCY = 4
      let idx = 0
      const worker = async () => {
        while (!cancelled && idx < uncached.length) {
          const s = uncached[idx++]
          try {
            const title = await window.electronAPI.generateSessionTitle(s.sessionId, s.firstPrompt, s.latestPrompt || undefined)
            if (!cancelled && title) {
              setSessions(prev => prev.map(p => p.sessionId === s.sessionId ? { ...p, title } : p))
            }
          } catch {}
        }
      }
      Array.from({ length: CONCURRENCY }, worker)
      // Check if semantic search is available and kick off background indexing
      window.electronAPI.embeddingsAvailable()
        .then(available => {
          if (available) {
            setSemanticAvailable(true)
            window.electronAPI.ensureEmbeddings(claudeSessions).catch(() => {})
          }
        })
        .catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setGitInfo(null)
    if (!selected?.cwd) return
    window.electronAPI.getGitInfo(selected.cwd).then(setGitInfo).catch(() => {})
  }, [selected?.sessionId])

  useEffect(() => {
    setSummary(selected?.summary ?? null)
    if (!selected || !selected.firstPrompt) return
    if (selected.summary) return
    window.electronAPI.generateSessionSummary(selected.sessionId, selected.firstPrompt, selected.latestPrompt || undefined)
      .then(s => { if (s) { setSummary(s); setSessions(prev => prev.map(p => p.sessionId === selected.sessionId ? { ...p, summary: s } : p)) } })
      .catch(() => {})
  }, [selected?.sessionId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!ctxMenu) return
    const hide = () => setCtxMenu(null)
    window.addEventListener('click', hide)
    window.addEventListener('contextmenu', hide)
    return () => { window.removeEventListener('click', hide); window.removeEventListener('contextmenu', hide) }
  }, [ctxMenu])

  useEffect(() => {
    if (searchMode !== 'semantic' || !query.trim()) {
      setSemanticResults(null)
      return
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const claudeSessions = sessions.filter((session): session is ClaudeSession & { source: 'claude' } => session.source === 'claude')
        const results = await window.electronAPI.semanticSearch(query, claudeSessions)
        setSemanticResults(results.map(result => ({ session: { ...result.session, source: 'claude' as const }, score: result.score })))
      } catch {
        setSemanticResults(null)
      } finally {
        setIsSearching(false)
      }
    }, 400)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [query, searchMode, sessions])

  const handleRegenerateTitle = async (session: HistorySession) => {
    await window.electronAPI.clearTitleCache(session.sessionId)
    const title = await window.electronAPI.generateSessionTitle(session.sessionId, session.firstPrompt, session.latestPrompt || undefined)
    if (title) setSessions(prev => prev.map(s => s.sessionId === session.sessionId ? { ...s, title } : s))
  }

  const handleRegenerateSummary = async (session: HistorySession) => {
    await window.electronAPI.clearTitleCache(session.sessionId)
    if (selected?.sessionId === session.sessionId) setSummary(null)
    const s = await window.electronAPI.generateSessionSummary(session.sessionId, session.firstPrompt, session.latestPrompt || undefined)
    if (s) {
      setSessions(prev => prev.map(p => p.sessionId === session.sessionId ? { ...p, summary: s } : p))
      if (selected?.sessionId === session.sessionId) setSummary(s)
    }
  }

  const toggleFavorite = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      localStorage.setItem('claudesole:favorites', JSON.stringify([...next]))
      return next
    })
  }

  const filtered = useMemo(() => {
    if (searchMode === 'semantic' && semanticResults !== null) {
      return semanticResults.map(r => r.session)
    }
    const q = query.toLowerCase()
    return sessions.filter(s =>
      !q ||
      s.projectName.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      s.cwd.toLowerCase().includes(q) ||
      s.firstPrompt.toLowerCase().includes(q) ||
      (s.title || '').toLowerCase().includes(q)
    )
  }, [searchMode, semanticResults, query, sessions])

  const scoreMap = useMemo<Record<string, number>>(() => {
    if (!semanticResults) return {}
    return Object.fromEntries(semanticResults.map(r => [r.session.sessionId, r.score]))
  }, [semanticResults])

  const favSessions = filtered.filter(s => favorites.has(s.sessionId))
  const nonFavSessions = filtered.filter(s => !favorites.has(s.sessionId))
  const groups: Group[] = searchMode === 'semantic' && semanticResults !== null
    ? (filtered.length > 0 ? [{ label: 'Semantic results', sessions: filtered }] : [])
    : [
        ...(favSessions.length > 0 ? [{ label: '★ Favorites', sessions: favSessions }] : []),
        ...groupSessions(nonFavSessions),
      ]

  return (
    <div className="absolute inset-0 bg-app-900 flex flex-col z-50">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-app-700">
        <span className="text-[#555] text-xs font-semibold uppercase tracking-[0.08em] shrink-0">
          History
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search sessions…"
          className="flex-1 bg-white/[0.05] border border-app-500 rounded-md px-2.5 py-[5px] text-neutral-200 text-[13px] outline-none"
        />
        {semanticAvailable && (
          <button
            onClick={() => { setSearchMode(m => m === 'text' ? 'semantic' : 'text'); setSemanticResults(null) }}
            title={searchMode === 'semantic' ? 'Switch to text search' : 'Switch to semantic search'}
            className={clsx(
              'shrink-0 px-2 py-[5px] rounded-md text-[11px] border transition-colors duration-150',
              searchMode === 'semantic'
                ? 'border-blue-500/50 text-blue-400 bg-blue-400/[0.1]'
                : 'border-app-500 text-[#555] bg-white/[0.04]'
            )}
          >
            {isSearching ? 'Searching…' : '~ Semantic'}
          </button>
        )}
        <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={e => setSkipPermissions(e.target.checked)}
            className="accent-green-400 cursor-pointer"
          />
          <span className="text-[#666] text-[11px] whitespace-nowrap">--dangerously-skip-permissions</span>
        </label>
        <button
          onClick={onClose}
          className="bg-transparent border-0 text-[#555] text-lg cursor-pointer leading-none shrink-0"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Session list */}
        <div className="w-[340px] shrink-0 border-r border-app-800 overflow-y-auto py-2">
          {groups.length === 0 && (
            <div className="px-4 py-6 text-[#444] text-[13px]">
              {query ? 'No matching sessions' : 'No sessions found'}
            </div>
          )}
          {groups.map(group => (
            <div key={group.label}>
              <div className="px-4 pt-2 pb-1 text-[10px] text-[#444] font-semibold uppercase tracking-[0.08em]">
                {group.label}
              </div>
              {group.sessions.map(session => {
                const isSelected = selected?.sessionId === session.sessionId
                const isFav = favorites.has(session.sessionId)
                const isHovered = hoveredRow === session.sessionId
                return (
                  <div
                    key={session.sessionId}
                    onClick={() => setSelected(session)}
                    onDoubleClick={() => { onResume(session, skipPermissions) }}
                    onMouseEnter={() => setHoveredRow(session.sessionId)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, session }) }}
                    className={clsx(
                      'px-4 py-[7px] cursor-pointer border-l-2 flex items-start gap-1.5',
                      isSelected ? 'bg-white/[0.07] border-[#555]' : 'bg-transparent border-transparent'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className={clsx(
                          'text-[10px] font-mono shrink-0',
                          session.source === 'codex' ? 'text-purple-400' : 'text-green-400'
                        )}>
                          {session.source === 'codex' ? '[cx]' : '[cl]'}
                        </span>
                        <span className={clsx(
                          'text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap flex-1',
                          isSelected ? 'text-neutral-200' : 'text-[#bbb]'
                        )}>
                          {session.title || session.slug || session.projectName}
                        </span>
                        <span className="text-[#555] text-[11px] shrink-0">
                          {relativeTime(session.lastActivity)}
                        </span>
                        {scoreMap[session.sessionId] !== undefined && (
                          <span className="text-[9px] text-blue-400/60 font-mono shrink-0">
                            {(scoreMap[session.sessionId] * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {(session.latestPrompt || session.firstPrompt) && (
                        <div className="text-[#666] text-[11px] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                          {session.latestPrompt || session.firstPrompt}
                        </div>
                      )}
                    </div>
                    {(isFav || isHovered) && (
                      <span
                        onClick={(e) => toggleFavorite(session.sessionId, e)}
                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        className={clsx(
                          'text-base shrink-0 mt-px cursor-pointer leading-none transition-colors duration-150',
                          isFav ? 'text-gold' : 'text-[#444]'
                        )}
                      >
                        ★
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {selected ? (
          <div className="flex-1 px-7 py-6 overflow-y-auto flex flex-col gap-5">
            <div className="flex items-start gap-2.5">
              <div className="flex-1">
                <div className="text-neutral-200 text-lg font-semibold mb-1">
                  {selected.title || selected.slug || selected.projectName}
                </div>
                {selected.slug && (
                  <div className="text-[#666] text-[13px] flex items-center gap-2">
                    <span>{selected.projectName}</span>
                    <span className={clsx(
                      'text-[10px] font-mono',
                      selected.source === 'codex' ? 'text-purple-400' : 'text-green-400'
                    )}>
                      {selected.source === 'codex' ? '[cx]' : '[cl]'}
                    </span>
                  </div>
                )}
                {!selected.slug && (
                  <div className={clsx(
                    'text-[10px] font-mono',
                    selected.source === 'codex' ? 'text-purple-400' : 'text-green-400'
                  )}>
                    {selected.source === 'codex' ? '[cx]' : '[cl]'}
                  </div>
                )}
              </div>
              <span
                onClick={(e) => toggleFavorite(selected.sessionId, e)}
                title={favorites.has(selected.sessionId) ? 'Remove from favorites' : 'Add to favorites'}
                className={clsx(
                  'text-lg cursor-pointer leading-none mt-0.5 shrink-0 transition-colors duration-150',
                  favorites.has(selected.sessionId) ? 'text-gold' : 'text-[#333]'
                )}
              >
                ★
              </span>
            </div>

            {summary && (
              <div className="text-[#888] text-xs leading-relaxed italic">
                {summary}
              </div>
            )}
            {!summary && selected.firstPrompt && (
              <div className="text-[#444] text-[11px] italic">Generating summary…</div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label>Location</Label>
              <div className="text-[#888] text-xs break-all">{selected.cwd}</div>
              {gitInfo?.branch && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[#555] text-[11px]">⎇</span>
                  <span className="text-[#888] text-[11px]">{gitInfo.branch}</span>
                  <span className={clsx(
                    'text-[9px] border rounded-sm px-[5px] py-px uppercase tracking-[0.05em]',
                    gitInfo.isWorktree
                      ? 'text-blue-400 bg-blue-400/[0.12] border-blue-400/30'
                      : 'text-[#555] bg-white/[0.05] border-app-500'
                  )}>
                    {gitInfo.isWorktree ? 'worktree' : 'main'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Last active</Label>
              <div className="text-[#888] text-xs">{relativeTime(selected.lastActivity)}</div>
            </div>

            {selected.source === 'claude' && selected.tokensUsed !== undefined && (
              <ContextBar tokensUsed={selected.tokensUsed} />
            )}

            {selected.firstPrompt && (
              <div className="flex flex-col gap-1.5">
                <Label>First prompt</Label>
                <PromptBox text={selected.firstPrompt} />
              </div>
            )}

            {selected.latestPrompt && selected.latestPrompt !== selected.firstPrompt && (
              <div className="flex flex-col gap-1.5">
                <Label>Latest prompt</Label>
                <PromptBox text={selected.latestPrompt} dim />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label>Session ID</Label>
              <div className="text-[#444] text-[11px] font-mono break-all">
                {selected.sessionId}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-1 flex-wrap">
              <ActionButton onClick={() => onResume(selected, skipPermissions)} primary>
                Resume in new tab
              </ActionButton>
              <ActionButton
                onClick={() => onFork(selected, skipPermissions)}
                title="Opens a new session with this conversation's history via --fork-session"
              >
                Fork
              </ActionButton>
              <ActionButton onClick={() => handleRegenerateTitle(selected)}>
                Regenerate title
              </ActionButton>
              {selected.firstPrompt && (
                <ActionButton onClick={() => handleRegenerateSummary(selected)}>
                  Regenerate summary
                </ActionButton>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#333] text-[13px]">
            Select a session to view details
          </div>
        )}
      </div>

      {ctxMenu && (
        <div
          className="fixed z-[9999] bg-app-750 border border-app-400 rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.6)] p-1 min-w-[170px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <HistCtxItem onClick={() => { setCtxMenu(null); handleRegenerateTitle(ctxMenu.session) }}>
            Regenerate title
          </HistCtxItem>
          {ctxMenu.session.firstPrompt && (
            <HistCtxItem onClick={() => { setCtxMenu(null); handleRegenerateSummary(ctxMenu.session) }}>
              Regenerate summary
            </HistCtxItem>
          )}
        </div>
      )}
    </div>
  )
}

export type { HistorySession }

function HistCtxItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={clsx(
        'px-2.5 py-1.5 rounded cursor-pointer text-xs',
        hov ? 'bg-white/[0.06] text-neutral-200' : 'bg-transparent text-[#aaa]',
      )}
    >
      {children}
    </div>
  )
}

function PromptBox({ text, dim }: { text: string; dim?: boolean }) {
  return (
    <div className={clsx(
      'text-xs leading-[1.7] bg-white/[0.03] border border-app-700 rounded-md px-3 py-2.5 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto',
      dim ? 'text-[#888]' : 'text-[#aaa]'
    )}>
      {text}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-[#555] font-semibold uppercase tracking-[0.08em]">
      {children}
    </div>
  )
}

function ActionButton({ children, onClick, primary, title }: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  title?: string
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={clsx(
        'px-4 py-[7px] rounded-md text-xs cursor-pointer font-[inherit] transition-colors duration-150',
        primary
          ? clsx('border-0', hov ? 'bg-green-400/[0.25] text-green-400' : 'bg-green-400/[0.15] text-green-400')
          : clsx('border border-app-500', hov ? 'bg-white/[0.08] text-[#888]' : 'bg-white/[0.04] text-[#888]')
      )}
    >
      {children}
    </button>
  )
}
