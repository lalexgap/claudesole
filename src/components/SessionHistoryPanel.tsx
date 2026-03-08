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

export function SessionHistoryPanel({ onResume, onFork, onClose }: Props) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ClaudeSession | null>(null)
  const [skipPermissions, setSkipPermissions] = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    window.electronAPI.listSessions().then(setSessions)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const q = query.toLowerCase()
  const filtered = sessions.filter(s =>
    !q ||
    s.projectName.toLowerCase().includes(q) ||
    s.slug.toLowerCase().includes(q) ||
    s.cwd.toLowerCase().includes(q) ||
    s.firstPrompt.toLowerCase().includes(q)
  )

  const groups = groupSessions(filtered)

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
                return (
                  <div
                    key={session.sessionId}
                    onClick={() => setSelected(session)}
                    onDoubleClick={() => { onResume(session, skipPermissions) }}
                    style={{
                      padding: '7px 16px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(255,255,255,0.07)' : 'transparent',
                      borderLeft: `2px solid ${isSelected ? '#555' : 'transparent'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                      <span style={{
                        color: isSelected ? '#e5e5e5' : '#bbb',
                        fontSize: '13px', fontWeight: 500,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        flex: 1,
                      }}>
                        {session.slug || session.projectName}
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
            <div>
              <div style={{ color: '#e5e5e5', fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                {selected.slug || selected.projectName}
              </div>
              {selected.slug && (
                <div style={{ color: '#666', fontSize: '13px' }}>{selected.projectName}</div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <Label>Location</Label>
              <div style={{ color: '#888', fontSize: '12px', wordBreak: 'break-all' }}>{selected.cwd}</div>
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
