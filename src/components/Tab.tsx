import React, { useState, useRef, useEffect } from 'react'
import { Session } from '../store/sessions'

interface TabProps {
  session: Session
  isActive: boolean
  onClick: () => void
  onClose: (e: React.MouseEvent) => void
  onRename: (label: string) => void
  onPin: () => void
  onFork: () => void
  onSplitH: () => void
  onSplitV: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent, el: HTMLDivElement) => void
  onDragEnd?: () => void
}

export function Tab({ session, isActive, onClick, onClose, onRename, onPin, onFork, onSplitH, onSplitV, onDragStart, onDragOver, onDragEnd }: TabProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const [draggable, setDraggable] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isShell = session.type === 'shell'
  const bg = isShell
    ? session.status === 'running'
      ? isActive ? 'rgba(96,165,250,0.18)' : 'rgba(96,165,250,0.13)'
      : isActive ? 'rgba(100,116,139,0.18)' : 'rgba(100,116,139,0.10)'
    : session.status === 'running'
      ? isActive ? 'rgba(74,222,128,0.18)' : 'rgba(74,222,128,0.13)'
      : isActive ? 'rgba(248,113,113,0.18)' : 'rgba(248,113,113,0.13)'
  const borderColor = isShell
    ? session.status === 'running' ? 'rgba(96,165,250,0.35)' : 'rgba(100,116,139,0.35)'
    : session.status === 'running' ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)'

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
        onDragEnd={e => { setDraggable(false); onDragEnd?.() }}
        style={{
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 10px 4px 8px',
          borderRadius: '6px',
          cursor: 'pointer',
          background: bg,
          border: `1px solid ${isActive ? borderColor : 'transparent'}`,
          color: isActive ? '#fff' : '#aaa',
          fontSize: '13px',
          userSelect: 'none',
          maxWidth: '160px',
          flexShrink: 0,
          transition: 'background 0.3s, border-color 0.3s',
        } as React.CSSProperties}
      >
        {session.pinned && (
          <span style={{ fontSize: '9px', color: '#f6c90e', flexShrink: 0, lineHeight: 1 }}>★</span>
        )}
        {isShell ? (
          <span style={{ fontSize: '10px', color: '#60a5fa', flexShrink: 0, lineHeight: 1, opacity: 0.8 }}>$</span>
        ) : (
          <span style={{ fontSize: '11px', flexShrink: 0, lineHeight: 1 }}>
            {session.status === 'running' ? '🤖' : '👤'}
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
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '3px',
              color: '#fff',
              fontSize: '12px',
              padding: '1px 4px',
              outline: 'none',
              width: '90px',
            }}
          />
        ) : (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {session.label}
          </span>
        )}
        <span
          onClick={onClose}
          style={{
            WebkitAppRegion: 'no-drag',
            fontSize: '14px',
            lineHeight: 1,
            color: '#777',
            marginLeft: '2px',
            cursor: 'pointer',
            flexShrink: 0,
          } as React.CSSProperties}
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
          onCloseTab={(e) => { setCtxMenu(null); onClose(e) }}
        />
      )}
    </>
  )
}

function TabContextMenu({ x, y, isPinned, isShell, onClose, onRename, onPin, onFork, onSplitH, onSplitV, onCloseTab }: {
  x: number; y: number; isPinned: boolean; isShell: boolean
  onClose: () => void; onRename: () => void; onPin: () => void
  onFork: () => void; onSplitH: () => void; onSplitV: () => void
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
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 9999,
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        padding: '4px',
        minWidth: '160px',
      }}
      onClick={e => e.stopPropagation()}
    >
      <CtxItem onClick={onRename}>Rename</CtxItem>
      <CtxItem onClick={onPin}>{isPinned ? 'Unpin' : 'Pin'}</CtxItem>
      {!isShell && <CtxItem onClick={onFork}>Fork (new in same dir)</CtxItem>}
      <div style={{ height: '1px', background: '#2a2a2a', margin: '3px 0' }} />
      <CtxItem onClick={onSplitH}>Split right →</CtxItem>
      <CtxItem onClick={onSplitV}>Split below ↓</CtxItem>
      <div style={{ height: '1px', background: '#2a2a2a', margin: '3px 0' }} />
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
      style={{
        padding: '6px 10px',
        borderRadius: '5px',
        cursor: 'pointer',
        fontSize: '12px',
        color: danger ? (hov ? '#ff7070' : '#cc4444') : (hov ? '#e5e5e5' : '#aaa'),
        background: hov ? 'rgba(255,255,255,0.06)' : 'transparent',
      }}
    >
      {children}
    </div>
  )
}
