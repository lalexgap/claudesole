import React, { useState, useRef, useEffect } from 'react'
import clsx from 'clsx'
import { Session } from '../store/sessions'

interface TabProps {
  session: Session
  isActive: boolean
  splitLabel?: string
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
  onRename: (label: string) => void
  onPin: () => void
  onFork: () => void
  onSplitH: () => void
  onSplitV: () => void
  onRegenerateTitle?: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent, el: HTMLDivElement) => void
  onDragEnd?: () => void
}

export function Tab({ session, isActive, splitLabel, onClick, onClose, onRename, onPin, onFork, onSplitH, onSplitV, onRegenerateTitle, onDragStart, onDragOver, onDragEnd }: TabProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const [draggable, setDraggable] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isShell = session.type === 'shell'
  const isCodex = session.type === 'codex'
  const isEditor = session.type === 'editor'
  const isRunning = session.status === 'running'
  const isDirty = !!session.isDirty

  const startEdit = () => {
    setEditValue(session.label)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitEdit = () => {
    if (editValue.trim()) onRename(editValue.trim())
    setEditing(false)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  const bgCls = clsx({
    // Editor (independent of running/waiting)
    'bg-amber-400/[0.18]': isEditor && isActive,
    'bg-amber-400/[0.10]': isEditor && !isActive,
    // Shell running
    'bg-blue-400/[0.18]': !isEditor && isShell && isRunning && isActive,
    'bg-blue-400/[0.13]': !isEditor && isShell && isRunning && !isActive,
    // Shell idle
    'bg-slate-500/[0.18]': !isEditor && isShell && !isRunning && isActive,
    'bg-slate-500/[0.10]': !isEditor && isShell && !isRunning && !isActive,
    // Codex running
    'bg-purple-400/[0.18]': !isEditor && isCodex && isRunning && isActive,
    'bg-purple-400/[0.13]': !isEditor && isCodex && isRunning && !isActive,
    // Codex waiting
    'bg-orange-400/[0.18]': !isEditor && isCodex && !isRunning && isActive,
    'bg-orange-400/[0.13]': !isEditor && isCodex && !isRunning && !isActive,
    // Claude running
    'bg-green-400/[0.18]': !isEditor && !isShell && !isCodex && isRunning && isActive,
    'bg-green-400/[0.13]': !isEditor && !isShell && !isCodex && isRunning && !isActive,
    // Claude waiting
    'bg-red-400/[0.18]': !isEditor && !isShell && !isCodex && !isRunning && isActive,
    'bg-red-400/[0.13]': !isEditor && !isShell && !isCodex && !isRunning && !isActive,
  })

  const borderCls = isActive
    ? clsx({
        'border-amber-400/[0.35]': isEditor,
        'border-blue-400/[0.35]': !isEditor && isShell && isRunning,
        'border-slate-500/[0.35]': !isEditor && isShell && !isRunning,
        'border-purple-400/[0.35]': !isEditor && isCodex && isRunning,
        'border-orange-400/[0.35]': !isEditor && isCodex && !isRunning,
        'border-green-400/[0.35]': !isEditor && !isShell && !isCodex && isRunning,
        'border-red-400/[0.35]': !isEditor && !isShell && !isCodex && !isRunning,
      })
    : 'border-transparent'

  return (
    <>
      <div
        ref={divRef}
        draggable={draggable}
        onClick={onClick}
        onDoubleClick={startEdit}
        onContextMenu={handleContextMenu}
        onMouseDown={e => {
          if (e.button === 0) setDraggable(true)
          if (e.button === 2) handleContextMenu(e)
        }}
        onMouseUp={() => setDraggable(false)}
        onDragStart={onDragStart}
        onDragOver={e => divRef.current && onDragOver?.(e, divRef.current)}
        onDragEnd={() => { setDraggable(false); onDragEnd?.() }}
        className={clsx(
          'flex items-center gap-1 py-1 pl-2 pr-2.5 rounded-md cursor-pointer border select-none max-w-[160px] shrink-0 transition-[background,border-color] duration-300',
          isActive ? 'text-white' : 'text-[#aaa]',
          bgCls,
          borderCls,
        )}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {session.pinned && (
          <span className="text-[9px] text-gold shrink-0 leading-none">★</span>
        )}
        {isEditor ? (
          <span className="text-[10px] text-amber-300 shrink-0 leading-none opacity-90">
            {isDirty ? '●' : '◯'}
          </span>
        ) : isShell ? (
          <span className="text-[10px] text-blue-400 shrink-0 leading-none opacity-80">$</span>
        ) : (
          <span className="text-[11px] shrink-0 leading-none">
            {isRunning ? '🤖' : '👤'}
          </span>
        )}
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') setEditing(false)
              e.stopPropagation()
            }}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-white/10 border border-white/20 rounded-sm text-white text-xs px-1 py-px outline-none w-[90px]"
          />
        ) : (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1 text-[13px]">
            {splitLabel ?? (() => {
              const defaultLabel = session.cwd.split('/').pop() || session.cwd
              const userRenamed = session.label !== defaultLabel
              return userRenamed ? session.label : (session.branch || session.label)
            })()}
          </span>
        )}
        <span
          onClick={onClose}
          className="text-sm leading-none text-[#777] ml-0.5 cursor-pointer shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          ×
        </span>
      </div>

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          isPinned={session.pinned}
          isShell={isShell}
          onClose={() => setCtxMenu(null)}
          onRename={() => { setCtxMenu(null); startEdit() }}
          onPin={() => { setCtxMenu(null); onPin() }}
          onFork={() => { setCtxMenu(null); onFork() }}
          onSplitH={() => { setCtxMenu(null); onSplitH() }}
          onSplitV={() => { setCtxMenu(null); onSplitV() }}
          onRegenerateTitle={onRegenerateTitle ? () => { setCtxMenu(null); onRegenerateTitle() } : undefined}
          onCloseTab={(e) => { setCtxMenu(null); onClose(e) }}
        />
      )}
    </>
  )
}

function TabContextMenu({ x, y, isPinned, isShell, onClose, onRename, onPin, onFork, onSplitH, onSplitV, onRegenerateTitle, onCloseTab }: {
  x: number; y: number; isPinned: boolean; isShell: boolean
  onClose: () => void; onRename: () => void; onPin: () => void
  onFork: () => void; onSplitH: () => void; onSplitV: () => void
  onRegenerateTitle?: () => void
  onCloseTab: (e: React.MouseEvent) => void
}) {
  useEffect(() => {
    const hide = () => onClose()
    window.addEventListener('click', hide)
    window.addEventListener('contextmenu', hide)
    return () => { window.removeEventListener('click', hide); window.removeEventListener('contextmenu', hide) }
  }, [onClose])

  return (
    <div
      className="fixed z-[9999] bg-app-750 border border-app-400 rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.6)] p-1 min-w-[160px]"
      style={{ top: y, left: x }}
      onClick={e => e.stopPropagation()}
    >
      <CtxItem onClick={onRename}>Rename</CtxItem>
      <CtxItem onClick={onPin}>{isPinned ? 'Unpin' : 'Pin'}</CtxItem>
      {!isShell && <CtxItem onClick={onFork}>Fork (new in same dir)</CtxItem>}
      {!isShell && onRegenerateTitle && <CtxItem onClick={onRegenerateTitle}>Regenerate title</CtxItem>}
      <div className="h-px bg-app-500 my-[3px]" />
      <CtxItem onClick={onSplitH}>Split right →</CtxItem>
      <CtxItem onClick={onSplitV}>Split below ↓</CtxItem>
      <div className="h-px bg-app-500 my-[3px]" />
      <CtxItem onClick={onCloseTab} danger>Close tab</CtxItem>
    </div>
  )
}

function CtxItem({ children, onClick, danger }: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={clsx(
        'px-2.5 py-1.5 rounded cursor-pointer text-xs',
        hov ? 'bg-white/[0.06]' : 'bg-transparent',
        danger
          ? hov ? 'text-[#ff7070]' : 'text-[#cc4444]'
          : hov ? 'text-neutral-200' : 'text-[#aaa]',
      )}
    >
      {children}
    </div>
  )
}
