import React, { useState, useRef } from 'react'
import { Session, useSessionsStore } from '../store/sessions'
import { Tab } from './Tab'

interface TabBarProps {
  sessions: Session[]
  activeId: string | null
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewTab: () => void
  onNewShellTab: () => void
  onRenameTab: (id: string, label: string) => void
  onPinTab: (id: string) => void
  onForkTab: (id: string) => void
  onSplitHTab: (id: string) => void
  onSplitVTab: (id: string) => void
  historyOpen: boolean
  onToggleHistory: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  worktreesOpen: boolean
  onToggleWorktrees: () => void
}

export function TabBar({
  sessions, activeId, onSelectTab, onCloseTab, onNewTab, onNewShellTab,
  onRenameTab, onPinTab, onForkTab, onSplitHTab, onSplitVTab,
  historyOpen, onToggleHistory, sidebarOpen, onToggleSidebar,
  worktreesOpen, onToggleWorktrees,
}: TabBarProps) {
  const reorderSession = useSessionsStore((s) => s.reorderSession)
  const dragId = useRef<string | null>(null)
  const [insertIndex, setInsertIndex] = useState<number | null>(null)

  const handleDragStart = (e: React.DragEvent, id: string) => {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, index: number, el: HTMLDivElement) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = el.getBoundingClientRect()
    const mid = rect.left + rect.width / 2
    setInsertIndex(e.clientX < mid ? index : index + 1)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (dragId.current !== null && insertIndex !== null) {
      reorderSession(dragId.current, insertIndex)
    }
    dragId.current = null
    setInsertIndex(null)
  }

  const handleDragEnd = () => {
    dragId.current = null
    setInsertIndex(null)
  }

  const indicator = (
    <div style={{ width: '2px', height: '24px', background: '#4ade80', borderRadius: '1px', flexShrink: 0 }} />
  )

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '40px',
        paddingRight: '8px',
        background: '#111',
        borderBottom: '1px solid #222',
        gap: '2px',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      {/* Traffic light spacer — draggable so window can be moved from this area */}
      <div style={{ width: '76px', flexShrink: 0, alignSelf: 'stretch', WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {sessions.map((session, i) => (
        <React.Fragment key={session.id}>
          {insertIndex === i && indicator}
          <Tab
            session={session}
            isActive={session.id === activeId}
            onClick={() => onSelectTab(session.id)}
            onClose={(e) => { e.stopPropagation(); onCloseTab(session.id) }}
            onRename={(label) => onRenameTab(session.id, label)}
            onPin={() => onPinTab(session.id)}
            onFork={() => onForkTab(session.id)}
            onSplitH={() => onSplitHTab(session.id)}
            onSplitV={() => onSplitVTab(session.id)}
            onDragStart={e => handleDragStart(e, session.id)}
            onDragOver={(e, el) => handleDragOver(e, i, el)}
            onDragEnd={handleDragEnd}
          />
        </React.Fragment>
      ))}
      {insertIndex === sessions.length && indicator}

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

      <button
        onClick={onNewShellTab}
        style={{
          WebkitAppRegion: 'no-drag',
          background: 'none',
          border: 'none',
          color: '#555',
          fontSize: '11px',
          fontFamily: 'monospace',
          lineHeight: 1,
          cursor: 'pointer',
          padding: '2px 6px',
          borderRadius: '4px',
          flexShrink: 0,
        } as React.CSSProperties}
        title="New shell tab"
      >
        $
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
        onClick={onToggleWorktrees}
        title="Git worktrees (⌘⇧G)"
        style={{
          WebkitAppRegion: 'no-drag',
          background: worktreesOpen ? 'rgba(255,255,255,0.08)' : 'none',
          border: 'none',
          color: worktreesOpen ? '#bbb' : '#555',
          fontSize: '13px',
          cursor: 'pointer',
          padding: '3px 6px',
          borderRadius: '4px',
          flexShrink: 0,
          lineHeight: 1,
        } as React.CSSProperties}
      >
        ⎇
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
