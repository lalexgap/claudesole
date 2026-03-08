import React, { useState, useEffect } from 'react'
import { Session } from '../store/sessions'
import { ContextBar } from './ContextBar'

interface Props {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onFork: (id: string) => void
  onNewSession: () => void
}

export function SessionSidebar({ sessions, activeId, onSelect, onClose, onFork, onNewSession }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [tokensUsed, setTokensUsed] = useState<number | undefined>(undefined)
  const [gitInfo, setGitInfo] = useState<{ branch: string | null; isWorktree: boolean } | null>(null)

  const selectedId = activeId
  const selectedSession = sessions.find(s => s.id === selectedId)

  useEffect(() => {
    setTokensUsed(undefined)
    setGitInfo(null)
    if (!selectedSession?.cwd) return
    window.electronAPI.getSessionUsage(selectedSession.cwd).then(usage => {
      setTokensUsed(usage?.tokensUsed)
    })
    window.electronAPI.getGitInfo(selectedSession.cwd).then(setGitInfo)
  }, [selectedSession?.id])

  return (
    <div style={{
      width: '220px',
      flexShrink: 0,
      background: '#141414',
      borderRight: '1px solid #222',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #1e1e1e',
        fontSize: '10px',
        color: '#666',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        flexShrink: 0,
      }}>
        Running sessions
      </div>

      {/* Session list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {sessions.length === 0 && (
          <div style={{ padding: '16px 12px', color: '#555', fontSize: '12px' }}>
            No active sessions
          </div>
        )}

        {sessions.map(session => {
          const isActive = session.id === activeId
          const isHovered = hovered === session.id
          const dotColor = session.status === 'running' ? '#4ade80' : '#f87171'

          return (
            <div
              key={session.id}
              onClick={() => onSelect(session.id)}
              onMouseEnter={() => setHovered(session.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                background: isActive
                  ? 'rgba(255,255,255,0.06)'
                  : isHovered ? 'rgba(255,255,255,0.03)' : 'transparent',
                borderLeft: `2px solid ${isActive ? '#666' : 'transparent'}`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
              }}
            >
              <div style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: dotColor, flexShrink: 0, marginTop: '4px',
                transition: 'background 0.2s',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: isActive ? '#e5e5e5' : '#bbb',
                  fontSize: '13px',
                  fontWeight: isActive ? 500 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {session.label}
                </div>
                <div style={{
                  color: '#666', fontSize: '10px', marginTop: '1px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {session.cwd}
                </div>
              </div>
              {isHovered && (
                <div
                  onClick={e => { e.stopPropagation(); onClose(session.id) }}
                  style={{ color: '#777', fontSize: '14px', lineHeight: 1, flexShrink: 0, padding: '0 2px' }}
                >
                  ×
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Selected session detail */}
      {selectedSession && (
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid #1e1e1e',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
              background: selectedSession.status === 'running' ? '#4ade80' : '#f87171',
              transition: 'background 0.2s',
            }} />
            <span style={{ color: '#ccc', fontSize: '12px', fontWeight: 500 }}>
              {selectedSession.label}
            </span>
            <span style={{
              fontSize: '9px', color: '#555', marginLeft: 'auto',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              {selectedSession.status === 'running' ? 'active' : 'idle'}
            </span>
          </div>
          <div style={{ color: '#555', fontSize: '10px', wordBreak: 'break-all', lineHeight: 1.4 }}>
            {selectedSession.cwd}
          </div>
          {gitInfo && gitInfo.branch && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ color: '#555', fontSize: '10px' }}>⎇</span>
              <span style={{ color: '#888', fontSize: '10px' }}>{gitInfo.branch}</span>
              <span style={{
                fontSize: '8px', color: gitInfo.isWorktree ? '#60a5fa' : '#555',
                background: gitInfo.isWorktree ? 'rgba(96,165,250,0.12)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${gitInfo.isWorktree ? 'rgba(96,165,250,0.3)' : '#2a2a2a'}`,
                borderRadius: '3px', padding: '1px 4px',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {gitInfo.isWorktree ? 'worktree' : 'main'}
              </span>
            </div>
          )}
          <ContextBar tokensUsed={tokensUsed} compact />
          {selectedSession.firstPrompt && (
            <div style={{
              color: '#666',
              fontSize: '11px',
              lineHeight: 1.5,
              marginTop: '2px',
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            } as React.CSSProperties}>
              {selectedSession.firstPrompt}
            </div>
          )}
          <div style={{ color: '#444', fontSize: '10px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {selectedSession.id}
          </div>
          <button
            onClick={() => onFork(selectedSession.id)}
            style={{
              marginTop: '4px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid #2a2a2a',
              borderRadius: '4px',
              color: '#888',
              fontSize: '11px',
              cursor: 'pointer',
              padding: '3px 8px',
              alignSelf: 'flex-start',
            }}
          >
            Fork session
          </button>
        </div>
      )}

      {/* Footer */}
      <div
        onClick={onNewSession}
        style={{
          padding: '8px 12px',
          borderTop: '1px solid #1e1e1e',
          cursor: 'pointer',
          color: '#777',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#4ade80', fontSize: '13px' }}>+</span>
        New session
      </div>
    </div>
  )
}
