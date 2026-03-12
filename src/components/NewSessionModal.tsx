import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ClaudeSession } from '../types/ipc'

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

type Item =
  | { type: 'session'; session: ClaudeSession }
  | { type: 'folder'; cwd: string }
  | { type: 'browse' }

export interface SessionOpts { skipPermissions: boolean; worktree: boolean }

interface Props {
  onResume: (session: ClaudeSession, opts: SessionOpts) => void
  onNewInFolder: (cwd: string, opts: SessionOpts) => void
  onBrowse: (opts: SessionOpts) => void
  onClose: () => void
}

export function NewSessionModal({ onResume, onNewInFolder, onBrowse, onClose }: Props) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [hoveredSession, setHoveredSession] = useState<ClaudeSession | null>(null)
  const [skipPermissions, setSkipPermissions] = useState(true)
  const [worktree, setWorktree] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    searchRef.current?.focus()
    window.electronAPI.listSessions().then(setSessions)
  }, [])

  const q = query.toLowerCase()

  const filteredSessions = useMemo(() => sessions.filter(s =>
    !q ||
    s.projectName.toLowerCase().includes(q) ||
    s.slug.toLowerCase().includes(q) ||
    s.cwd.toLowerCase().includes(q) ||
    s.firstPrompt.toLowerCase().includes(q)
  ), [sessions, q])

  const recentFolders = useMemo(() => [...new Set(sessions.map(s => s.cwd))]
    .filter(cwd => !q || cwd.toLowerCase().includes(q))
    .slice(0, 3), [sessions, q])

  const items: Item[] = useMemo(() => [
    ...filteredSessions.map(s => ({ type: 'session' as const, session: s })),
    ...recentFolders.map(cwd => ({ type: 'folder' as const, cwd })),
    { type: 'browse' },
  ], [filteredSessions, recentFolders])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    itemRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const opts: SessionOpts = { skipPermissions, worktree }

  const activate = useCallback((item: Item) => {
    if (item.type === 'session') onResume(item.session, opts)
    else if (item.type === 'folder') onNewInFolder(item.cwd, opts)
    else onBrowse(opts)
  }, [onResume, onNewInFolder, onBrowse, skipPermissions, worktree])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter') { e.preventDefault(); const item = items[selected]; if (item) activate(item) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, selected, activate, onClose])

  const sessionOffset = 0
  const folderOffset = filteredSessions.length
  const browseOffset = folderOffset + recentFolders.length

  const activeSession: ClaudeSession | null =
    hoveredSession ??
    (selected < filteredSessions.length ? filteredSessions[selected] : null)

  const rowStyle = (idx: number): React.CSSProperties => ({
    padding: '8px 12px',
    cursor: 'pointer',
    background: selected === idx ? 'rgba(255,255,255,0.07)' : 'transparent',
    borderRadius: '6px',
    margin: '1px 4px',
  })

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '80px',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex',
          height: '520px',
          background: '#1c1c1c',
          borderRadius: '12px',
          border: '1px solid #323232',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {/* Left: list */}
        <div style={{ width: '360px', display: 'flex', flexDirection: 'column' }}>

          {/* Header: search + checkbox */}
          <div style={{ flexShrink: 0, borderBottom: '1px solid #272727' }}>
            <div style={{ padding: '12px 14px 10px' }}>
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search sessions…"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#e5e5e5',
                  fontSize: '14px',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 14px 10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={skipPermissions}
                  onChange={e => setSkipPermissions(e.target.checked)}
                  style={{ accentColor: '#4ade80', cursor: 'pointer' }}
                />
                <span style={{ color: '#777', fontSize: '11px' }}>--dangerously-skip-permissions</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={worktree}
                  onChange={e => setWorktree(e.target.checked)}
                  style={{ accentColor: '#60a5fa', cursor: 'pointer' }}
                />
                <span style={{ color: '#777', fontSize: '11px' }}>--worktree</span>
              </label>
            </div>
          </div>

          {/* Sessions: scrollable */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filteredSessions.length > 0 && (
              <>
                <SectionLabel>Resume session</SectionLabel>
                {filteredSessions.map((session, i) => (
                  <div
                    key={session.sessionId}
                    ref={el => { if (el) itemRefs.current.set(sessionOffset + i, el); else itemRefs.current.delete(sessionOffset + i) }}
                    style={rowStyle(sessionOffset + i)}
                    onClick={() => onResume(session, opts)}
                    onMouseEnter={() => { setSelected(sessionOffset + i); setHoveredSession(session) }}
                    onMouseLeave={() => setHoveredSession(null)}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      <span style={{ color: '#d4d4d4', fontWeight: 500, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.slug || session.projectName}
                      </span>
                      <span style={{ color: '#666', fontSize: '11px', marginLeft: 'auto', flexShrink: 0 }}>
                        {relativeTime(session.lastActivity)}
                      </span>
                    </div>
                    <div style={{ color: '#777', fontSize: '11px', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.projectName}{session.slug ? ` · ${session.cwd}` : ''}
                    </div>
                    {(session.latestPrompt || session.firstPrompt) && (
                      <div style={{
                        color: '#888',
                        fontSize: '11px',
                        lineHeight: '1.5',
                        marginTop: '3px',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      } as React.CSSProperties}>
                        {session.latestPrompt || session.firstPrompt}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
            {filteredSessions.length === 0 && (
              <div style={{ padding: '16px', color: '#555', fontSize: '12px' }}>
                {query ? 'No matching sessions' : 'No recent sessions found'}
              </div>
            )}
          </div>

          {/* Footer: new session — always visible */}
          <div style={{ flexShrink: 0, borderTop: '1px solid #272727' }}>
            <SectionLabel style={{ paddingTop: '6px', paddingBottom: '2px' }}>New session</SectionLabel>
            {recentFolders.map((cwd, i) => (
              <div
                key={cwd}
                ref={el => { if (el) itemRefs.current.set(folderOffset + i, el); else itemRefs.current.delete(folderOffset + i) }}
                style={{ ...rowStyle(folderOffset + i), display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px' }}
                onClick={() => onNewInFolder(cwd, opts)}
                onMouseEnter={() => { setSelected(folderOffset + i); setHoveredSession(null) }}
              >
                <span style={{ color: '#4ade80', fontSize: '11px', flexShrink: 0 }}>+</span>
                <span style={{ color: '#d4d4d4', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {cwd.split('/').pop()}
                </span>
                <span style={{ color: '#555', fontSize: '10px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                  {cwd.split('/').slice(0, -1).join('/').replace('/Users/' + cwd.split('/')[2], '~')}
                </span>
              </div>
            ))}
            <div
              ref={el => { if (el) itemRefs.current.set(browseOffset, el); else itemRefs.current.delete(browseOffset) }}
              style={{ ...rowStyle(browseOffset), display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px', margin: '1px 4px 4px' }}
              onClick={() => onBrowse(opts)}
              onMouseEnter={() => { setSelected(browseOffset); setHoveredSession(null) }}
            >
              <span style={{ color: '#555', fontSize: '12px' }}>⊕</span>
              <span style={{ color: '#888', fontSize: '12px' }}>Browse for folder…</span>
            </div>
          </div>
        </div>

        {/* Right: detail panel — always rendered to prevent width jumps */}
        <div style={{ width: '280px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', borderLeft: '1px solid #272727' }}>
          {!activeSession && (
            <div style={{ color: '#444', fontSize: '12px', marginTop: '8px' }}>Select a session to see details</div>
          )}
          {activeSession && (<>
            <div>
              <div style={{ color: '#e5e5e5', fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>
                {activeSession.slug || activeSession.projectName}
              </div>
              {activeSession.slug && (
                <div style={{ color: '#888', fontSize: '11px' }}>{activeSession.projectName}</div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <DetailLabel>Location</DetailLabel>
              <div style={{ color: '#999', fontSize: '11px', wordBreak: 'break-all' }}>{activeSession.cwd}</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <DetailLabel>Last active</DetailLabel>
              <div style={{ color: '#999', fontSize: '11px' }}>{relativeTime(activeSession.lastActivity)}</div>
            </div>

            {activeSession.latestPrompt && activeSession.latestPrompt !== activeSession.firstPrompt && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <DetailLabel>Last prompt</DetailLabel>
                <div style={{
                  color: '#aaa',
                  fontSize: '11px',
                  lineHeight: '1.6',
                  display: '-webkit-box',
                  WebkitLineClamp: 5,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                } as React.CSSProperties}>
                  {activeSession.latestPrompt}
                </div>
              </div>
            )}

            {activeSession.firstPrompt && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <DetailLabel>First prompt</DetailLabel>
                <div style={{
                  color: '#666',
                  fontSize: '11px',
                  lineHeight: '1.6',
                  display: '-webkit-box',
                  WebkitLineClamp: 5,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                } as React.CSSProperties}>
                  {activeSession.firstPrompt}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <DetailLabel>Session ID</DetailLabel>
              <div style={{ color: '#555', fontSize: '10px', wordBreak: 'break-all' }}>
                {activeSession.sessionId}
              </div>
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      padding: '8px 16px 3px',
      fontSize: '10px',
      color: '#666',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      ...style,
    }}>
      {children}
    </div>
  )
}

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {children}
    </div>
  )
}
