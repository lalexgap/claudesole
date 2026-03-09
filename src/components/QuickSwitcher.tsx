import React, { useState, useEffect, useRef } from 'react'
import { Session } from '../store/sessions'

interface Props {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: () => void
}

export function QuickSwitcher({ sessions, activeId, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = sessions.filter(s => {
    const q = query.toLowerCase()
    return !q || s.label.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)
  })

  useEffect(() => { setIdx(0) }, [query])

  const commit = (s: Session) => { onSelect(s.id); onClose() }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && filtered[idx]) commit(filtered[idx])
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '80px', background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: '10px', width: '480px', maxHeight: '420px', boxShadow: '0 16px 48px rgba(0,0,0,0.8)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Switch to session…"
          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #2a2a2a', outline: 'none', color: '#e5e5e5', fontSize: '14px', padding: '14px 16px' }}
        />

        <div style={{ overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '20px 16px', color: '#555', fontSize: '13px', textAlign: 'center' }}>No sessions match</div>
          )}
          {filtered.map((s, i) => (
            <div
              key={s.id}
              onClick={() => commit(s)}
              onMouseEnter={() => setIdx(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '9px 16px', cursor: 'pointer',
                background: i === idx ? 'rgba(255,255,255,0.07)' : 'transparent',
                borderLeft: i === idx ? '2px solid #4ade80' : '2px solid transparent',
              }}
            >
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                background: s.type === 'shell'
                  ? (s.status === 'running' ? '#60a5fa' : '#64748b')
                  : (s.status === 'running' ? '#4ade80' : '#f87171'),
              }} />
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ color: s.id === activeId ? '#fff' : '#ccc', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.pinned && <span style={{ color: '#f6c90e', marginRight: '4px', fontSize: '10px' }}>★</span>}
                  {s.label}
                </div>
                <div style={{ color: '#555', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                  {s.cwd}
                </div>
              </div>
              {s.type === 'shell' && <span style={{ color: '#60a5fa', fontSize: '10px', fontFamily: 'monospace' }}>$</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
