import { useState, useEffect, useRef } from 'react'
import { ClaudeSession } from '../types/ipc'
import { ContextBar } from './ContextBar'

interface Props {
  onResume: (session: ClaudeSession, skipPermissions: boolean) => void
  onFork: (session: ClaudeSession, skipPermissions: boolean) => void
  onClose: () => void
}

interface Group {
  label: string
  sessions: ClaudeSession[]
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

function groupSessions(sessions: ClaudeSession[]): Group[] {
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
  const [sessions, setSessions] = useState<ClaudeSession[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ClaudeSession | null>(null)
  const [skipPermissions, setSkipPermissions] = useState(true)
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [gitInfo, setGitInfo] = useState<{ branch: string | null; isWorktree: boolean } | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    window.electronAPI.listSessions().then(all => {
      setSessions(all)
      // Fire async title generation for up to 20 uncached sessions
      const uncached = all.filter(s => !s.title && (s.firstPrompt || s.latestPrompt)).slice(0, 20)
      for (const s of uncached) {
        window.electronAPI.generateSessionTitle(s.sessionId, s.firstPrompt, s.latestPrompt || undefined)
          .then(title => {
            if (title) setSessions(prev => prev.map(p => p.sessionId === s.sessionId ? { ...p, title } : p))
          })
      }
    })
  }, [])

  useEffect(() => {
    setGitInfo(null)
    if (!selected?.cwd) return
    window.electronAPI.getGitInfo(selected.cwd).then(setGitInfo)
  }, [selected?.sessionId])

  useEffect(() => {
    setSummary(selected?.summary ?? null)
    if (!selected || !selected.firstPrompt) return
    if (selected.summary) return
    window.electronAPI.generateSessionSummary(selected.sessionId, selected.firstPrompt, selected.latestPrompt || undefined)
      .then(s => { if (s) { setSummary(s); setSessions(prev => prev.map(p => p.sessionId === selected.sessionId ? { ...p, summary: s } : p)) } })
  }, [selected?.sessionId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  const q = query.toLowerCase()
  const filtered = sessions.filter(s =>
    !q ||
    s.projectName.toLowerCase().includes(q) ||
    s.slug.toLowerCase().includes(q) ||
    s.cwd.toLowerCase().includes(q) ||
    s.firstPrompt.toLowerCase().includes(q) ||
    (s.title || '').toLowerCase().includes(q)
  )

  const favSessions = filtered.filter(s => favorites.has(s.sessionId))
  const nonFavSessions = filtered.filter(s => !favorites.has(s.sessionId))
  const groups: Group[] = [
    ...(favSessions.length > 0 ? [{ label: '★ Favorites', sessions: favSessions }] : []),
    ...groupSessions(nonFavSessions),
  ]

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: '#111',
      display: 'flex', flexDirection: 'column',
      zIndex: 50,
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 16px',
        borderBottom: '1px solid #1e1e1e',
      }}>
        <span style={{ color: '#555', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
          History
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search sessions…"
          style={{
            flex: 1, background: 'rgba(255,255,255,0.05)',
            border: '1px solid #2a2a2a', borderRadius: '6px',
            padding: '5px 10px', color: '#e5e5e5', fontSize: '13px', outline: 'none',
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={e => setSkipPermissions(e.target.checked)}
            style={{ accentColor: '#4ade80', cursor: 'pointer' }}
          />
          <span style={{ color: '#666', fontSize: '11px', whiteSpace: 'nowrap' }}>--dangerously-skip-permissions</span>
        </label>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#555',
            fontSize: '18px', cursor: 'pointer', lineHeight: 1, flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Session list */}
        <div style={{
          width: '340px', flexShrink: 0,
          borderRight: '1px solid #1a1a1a',
          overflowY: 'auto',
          padding: '8px 0',
        }}>
          {groups.length === 0 && (
            <div style={{ padding: '24px 16px', color: '#444', fontSize: '13px' }}>
              {query ? 'No matching sessions' : 'No sessions found'}
            </div>
          )}
          {groups.map(group => (
            <div key={group.label}>
              <div style={{
                padding: '8px 16px 4px',
                fontSize: '10px', color: '#444',
                fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
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
                    style={{
                      padding: '7px 16px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(255,255,255,0.07)' : 'transparent',
                      borderLeft: `2px solid ${isSelected ? '#555' : 'transparent'}`,
                      display: 'flex', alignItems: 'flex-start', gap: '6px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{
                          color: isSelected ? '#e5e5e5' : '#bbb',
                          fontSize: '13px', fontWeight: 500,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          flex: 1,
                        }}>
                          {session.title || session.slug || session.projectName}
                        </span>
                        <span style={{ color: '#555', fontSize: '11px', flexShrink: 0 }}>
                          {relativeTime(session.lastActivity)}
                        </span>
                      </div>
                      {(session.latestPrompt || session.firstPrompt) && (
                        <div style={{
                          color: '#666', fontSize: '11px', marginTop: '2px',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {session.latestPrompt || session.firstPrompt}
                        </div>
                      )}
                    </div>
                    {(isFav || isHovered) && (
                      <span
                        onClick={(e) => toggleFavorite(session.sessionId, e)}
                        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        style={{
                          fontSize: '16px', flexShrink: 0, marginTop: '1px',
                          color: isFav ? '#f6c90e' : '#444',
                          cursor: 'pointer', lineHeight: 1,
                          transition: 'color 0.15s',
                        }}
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
          <div style={{
            flex: 1, padding: '24px 28px',
            overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e5e5e5', fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                  {selected.title || selected.slug || selected.projectName}
                </div>
                {selected.slug && (
                  <div style={{ color: '#666', fontSize: '13px' }}>{selected.projectName}</div>
                )}
              </div>
              <span
                onClick={(e) => toggleFavorite(selected.sessionId, e)}
                title={favorites.has(selected.sessionId) ? 'Remove from favorites' : 'Add to favorites'}
                style={{
                  fontSize: '18px', cursor: 'pointer', lineHeight: 1, marginTop: '2px', flexShrink: 0,
                  color: favorites.has(selected.sessionId) ? '#f6c90e' : '#333',
                  transition: 'color 0.15s',
                }}
              >
                ★
              </span>
            </div>

            {summary && (
              <div style={{ color: '#888', fontSize: '12px', lineHeight: '1.6', fontStyle: 'italic' }}>
                {summary}
              </div>
            )}
            {!summary && selected.firstPrompt && (
              <div style={{ color: '#444', fontSize: '11px', fontStyle: 'italic' }}>Generating summary…</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Label>Location</Label>
              <div style={{ color: '#888', fontSize: '12px', wordBreak: 'break-all' }}>{selected.cwd}</div>
              {gitInfo?.branch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                  <span style={{ color: '#555', fontSize: '11px' }}>⎇</span>
                  <span style={{ color: '#888', fontSize: '11px' }}>{gitInfo.branch}</span>
                  <span style={{
                    fontSize: '9px',
                    color: gitInfo.isWorktree ? '#60a5fa' : '#555',
                    background: gitInfo.isWorktree ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${gitInfo.isWorktree ? 'rgba(96,165,250,0.3)' : '#2a2a2a'}`,
                    borderRadius: '3px', padding: '1px 5px',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {gitInfo.isWorktree ? 'worktree' : 'main'}
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Label>Last active</Label>
              <div style={{ color: '#888', fontSize: '12px' }}>{relativeTime(selected.lastActivity)}</div>
            </div>

            {selected.tokensUsed !== undefined && (
              <ContextBar tokensUsed={selected.tokensUsed} />
            )}

            {selected.firstPrompt && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Label>First prompt</Label>
                <PromptBox text={selected.firstPrompt} />
              </div>
            )}

            {selected.latestPrompt && selected.latestPrompt !== selected.firstPrompt && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Label>Latest prompt</Label>
                <PromptBox text={selected.latestPrompt} dim />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Label>Session ID</Label>
              <div style={{ color: '#444', fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {selected.sessionId}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <ActionButton
                onClick={() => onResume(selected, skipPermissions)}
                primary
              >
                Resume in new tab
              </ActionButton>
              <ActionButton
                onClick={() => onFork(selected, skipPermissions)}
                title="Opens a new session with this conversation's history via --fork-session"
              >
                Fork
              </ActionButton>
            </div>
          </div>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#333', fontSize: '13px',
          }}>
            Select a session to view details
          </div>
        )}
      </div>
    </div>
  )
}

function PromptBox({ text, dim }: { text: string; dim?: boolean }) {
  return (
    <div style={{
      color: dim ? '#888' : '#aaa', fontSize: '12px', lineHeight: 1.7,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid #1e1e1e',
      borderRadius: '6px', padding: '10px 12px',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      maxHeight: '200px', overflowY: 'auto',
    }}>
      {text}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
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
      style={{
        padding: '7px 16px',
        borderRadius: '6px',
        border: primary ? 'none' : '1px solid #2a2a2a',
        background: primary
          ? (hov ? 'rgba(74,222,128,0.25)' : 'rgba(74,222,128,0.15)')
          : (hov ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'),
        color: primary ? '#4ade80' : '#888',
        fontSize: '12px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.15s',
      }}
    >
      {children}
    </button>
  )
}
