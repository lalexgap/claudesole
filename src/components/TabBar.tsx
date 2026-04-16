import React, { useState, useRef } from 'react'
import clsx from 'clsx'
import { Session, useSessionsStore } from '../store/sessions'
import { Tab } from './Tab'
import { PaneNode, getLeafIds } from './SplitView'

interface TabBarProps {
  sessions: Session[]
  allSessions: Session[]
  paneRoots: Map<string, PaneNode>
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
  onRegenerateTitle: (id: string) => void
  historyOpen: boolean
  onToggleHistory: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  worktreesOpen: boolean
  onToggleWorktrees: () => void
  settingsOpen: boolean
  onToggleSettings: () => void
}

export function TabBar({
  sessions, allSessions, paneRoots, activeId, onSelectTab, onCloseTab, onNewTab, onNewShellTab,
  onRenameTab, onPinTab, onForkTab, onSplitHTab, onSplitVTab, onRegenerateTitle,
  historyOpen, onToggleHistory, sidebarOpen, onToggleSidebar,
  worktreesOpen, onToggleWorktrees, settingsOpen, onToggleSettings,
}: TabBarProps) {
  const getSplitLabel = (session: Session): string | undefined => {
    const root = paneRoots.get(session.id)
    if (!root) return undefined
    const leafIds = getLeafIds(root)
    if (leafIds.length <= 1) return undefined
    return leafIds.map(id => allSessions.find(s => s.id === id)?.label ?? id).join('/')
  }
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
    <div className="w-0.5 h-6 bg-green-400 rounded-sm shrink-0" />
  )

  const toolbarBtnCls = (isOpen: boolean) => clsx(
    'border-0 cursor-pointer px-2 py-1 rounded shrink-0 leading-none text-base',
    isOpen ? 'bg-white/[0.10] text-neutral-100' : 'bg-transparent text-[#999] hover:text-neutral-200'
  )

  return (
    <div
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      className="flex items-center h-10 pr-2 bg-app-900 border-b border-app-650 gap-0.5 overflow-x-auto shrink-0"
    >
      {/* Traffic light spacer — draggable so window can be moved from this area */}
      <div
        className="w-[76px] shrink-0 self-stretch"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {sessions.map((session, i) => (
        <React.Fragment key={session.id}>
          {insertIndex === i && indicator}
          <Tab
            session={session}
            isActive={session.id === activeId}
            splitLabel={getSplitLabel(session)}
            onClick={() => onSelectTab(session.id)}
            onClose={(e) => { e.stopPropagation(); onCloseTab(session.id) }}
            onRename={(label) => onRenameTab(session.id, label)}
            onPin={() => onPinTab(session.id)}
            onFork={() => onForkTab(session.id)}
            onSplitH={() => onSplitHTab(session.id)}
            onSplitV={() => onSplitVTab(session.id)}
            onRegenerateTitle={() => onRegenerateTitle(session.id)}
            onDragStart={e => handleDragStart(e, session.id)}
            onDragOver={(e, el) => handleDragOver(e, i, el)}
            onDragEnd={handleDragEnd}
          />
        </React.Fragment>
      ))}
      {insertIndex === sessions.length && indicator}

      <button
        onClick={onNewTab}
        className="bg-transparent border-0 text-[#999] hover:text-neutral-100 text-2xl leading-none cursor-pointer px-2 rounded shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="New session (⌘T)"
      >
        +
      </button>

      <button
        onClick={onNewShellTab}
        className="bg-transparent border-0 text-[#999] hover:text-neutral-100 text-[13px] font-mono leading-none cursor-pointer px-2 py-1 rounded shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="New shell tab"
      >
        $
      </button>

      <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <button
        onClick={onToggleHistory}
        title="Session history (⌘H)"
        className={toolbarBtnCls(historyOpen)}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        ◷
      </button>

      <button
        onClick={onToggleWorktrees}
        title="Git worktrees (⌘⇧G)"
        className={toolbarBtnCls(worktreesOpen)}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        ⎇
      </button>

      <button
        onClick={onToggleSidebar}
        title="Toggle sessions sidebar (⌘B)"
        className={toolbarBtnCls(sidebarOpen)}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        ☰
      </button>

      <button
        onClick={onToggleSettings}
        title="Settings (⌘,)"
        className={toolbarBtnCls(settingsOpen)}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        ⚙
      </button>
    </div>
  )
}
