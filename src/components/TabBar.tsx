import React from 'react'
import { Session } from '../store/sessions'
import { Tab } from './Tab'

interface TabBarProps {
  sessions: Session[]
  activeId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewTab: () => void
  onRenameTab: (id: string, label: string) => void
  onPinTab: (id: string) => void
  onForkTab: (id: string) => void
  historyOpen: boolean
  onToggleHistory: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function TabBar({
  sessions, activeId, onSelectTab, onCloseTab, onNewTab,
  onRenameTab, onPinTab, onForkTab, historyOpen, onToggleHistory, sidebarOpen, onToggleSidebar,
}: TabBarProps) {
  // Pinned sessions always appear first
  const sorted = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))

  return (
    <div
      style={{
        WebkitAppRegion: 'drag',
        display: 'flex',
        alignItems: 'center',
        height: '40px',
        paddingLeft: '76px',
        paddingRight: '8px',
        background: '#111',
        borderBottom: '1px solid #222',
        gap: '2px',
        overflowX: 'auto',
        flexShrink: 0,
      } as React.CSSProperties}
    >
      {sorted.map((session) => (
        <Tab
          key={session.id}
          session={session}
          isActive={session.id === activeId}
          onClick={() => onSelectTab(session.id)}
          onClose={(e) => { e.stopPropagation(); onCloseTab(session.id) }}
          onRename={(label) => onRenameTab(session.id, label)}
          onPin={() => onPinTab(session.id)}
          onFork={() => onForkTab(session.id)}
        />
      ))}

      <button
        onClick={onNewTab}
        style={{
          WebkitAppRegion: 'no-drag',
          background: 'none',
          border: 'none',
          color: '#666',
          fontSize: '20px',
          lineHeight: 1,
          cursor: 'pointer',
          padding: '0 8px',
          borderRadius: '4px',
          flexShrink: 0,
        } as React.CSSProperties}
        title="New session (⌘T)"
      >
        +
      </button>

      <div style={{ flex: 1, WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <button
        onClick={onToggleHistory}
        title="Session history (⌘H)"
        style={{
          WebkitAppRegion: 'no-drag',
          background: historyOpen ? 'rgba(255,255,255,0.08)' : 'none',
          border: 'none',
          color: historyOpen ? '#bbb' : '#555',
          fontSize: '12px',
          cursor: 'pointer',
          padding: '3px 6px',
          borderRadius: '4px',
          flexShrink: 0,
          lineHeight: 1,
        } as React.CSSProperties}
      >
        ◷
      </button>

      <button
        onClick={onToggleSidebar}
        title="Toggle sessions sidebar (⌘B)"
        style={{
          WebkitAppRegion: 'no-drag',
          background: sidebarOpen ? 'rgba(255,255,255,0.08)' : 'none',
          border: 'none',
          color: sidebarOpen ? '#bbb' : '#555',
          fontSize: '13px',
          cursor: 'pointer',
          padding: '3px 6px',
          borderRadius: '4px',
          flexShrink: 0,
          lineHeight: 1,
        } as React.CSSProperties}
      >
        ☰
      </button>
    </div>
  )
}
