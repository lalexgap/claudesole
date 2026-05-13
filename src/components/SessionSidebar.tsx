import React, { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import { Session } from '../store/sessions'
import { ContextBar } from './ContextBar'

const MIN_WIDTH = 160
const MAX_WIDTH = 400

interface Props {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onFork: (id: string) => void
  onRegenerateTitle: (id: string) => void
  onNewSession: () => void
}

export function SessionSidebar({ sessions, activeId, onSelect, onClose, onFork, onRegenerateTitle, onNewSession }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const [tokensUsed, setTokensUsed] = useState<number | undefined>(undefined)
  const [model, setModel] = useState<string | undefined>(undefined)
  const [gitInfo, setGitInfo] = useState<{ branch: string | null; isWorktree: boolean } | null>(null)
  const [summaries, setSummaries] = useState<Record<string, string>>({})
  const loadingSummaries = useRef<Set<string>>(new Set())
  const [width, setWidth] = useState(220)
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = width
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = e.clientX - dragStartX.current
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartWidth.current + delta)))
    }
    const onMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [width])

  const selectedSession = sessions.find(s => s.id === activeId)

  // Load summaries for all sessions
  useEffect(() => {
    sessions.forEach(session => {
      if (
        session.claudeSessionId &&
        session.firstPrompt &&
        !summaries[session.id] &&
        !loadingSummaries.current.has(session.id)
      ) {
        loadingSummaries.current.add(session.id)
        window.electronAPI.generateSessionSummary(session.claudeSessionId, session.firstPrompt)
          .then(s => {
            loadingSummaries.current.delete(session.id)
            if (s) setSummaries(prev => ({ ...prev, [session.id]: s }))
          })
          .catch(() => { loadingSummaries.current.delete(session.id) })
      }
    })
  }, [sessions])

  const regenerateSummary = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (!session?.claudeSessionId || !session.firstPrompt) return
    setSummaries(prev => { const next = { ...prev }; delete next[sessionId]; return next })
    loadingSummaries.current.delete(sessionId)
    loadingSummaries.current.add(sessionId)
    window.electronAPI.generateSessionSummary(session.claudeSessionId, session.firstPrompt)
      .then(s => {
        loadingSummaries.current.delete(sessionId)
        if (s) setSummaries(prev => ({ ...prev, [sessionId]: s }))
      })
      .catch(() => { loadingSummaries.current.delete(sessionId) })
  }

  // Load token usage and git info for selected session
  useEffect(() => {
    setTokensUsed(undefined)
    setModel(undefined)
    setGitInfo(null)
    if (!selectedSession?.cwd) return
    window.electronAPI.getSessionUsage(selectedSession.cwd).then(usage => {
      setTokensUsed(usage?.tokensUsed)
      setModel(usage?.model)
    })
    window.electronAPI.getGitInfo(selectedSession.cwd).then(setGitInfo)
  }, [selectedSession?.id])

  useEffect(() => {
    if (!ctxMenu) return
    const hide = () => setCtxMenu(null)
    window.addEventListener('click', hide)
    window.addEventListener('contextmenu', hide)
    return () => { window.removeEventListener('click', hide); window.removeEventListener('contextmenu', hide) }
  }, [ctxMenu])

  return (
    <div className="shrink-0 bg-app-850 border-r border-app-650 flex flex-col overflow-hidden relative" style={{ width }}>
      {/* Resize handle */}
      <div
        onMouseDown={onDragStart}
        className="absolute top-0 right-0 w-[4px] h-full cursor-col-resize z-10 hover:bg-white/[0.08] transition-colors"
      />
      <div className="px-3 py-2 border-b border-app-700 text-[10px] text-[#666] font-semibold uppercase tracking-[0.08em] shrink-0">
        Running sessions
      </div>

      {/* Session list */}
      <div className="overflow-y-auto flex-1">
        {sessions.length === 0 && (
          <div className="px-3 py-4 text-[#555] text-xs">
            No active sessions
          </div>
        )}

        {sessions.map(session => {
          const isActive = session.id === activeId
          const isHovered = hovered === session.id
          const summary = summaries[session.id]

          return (
            <div
              key={session.id}
              onClick={() => onSelect(session.id)}
              onMouseEnter={() => setHovered(session.id)}
              onMouseLeave={() => setHovered(null)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, id: session.id }) }}
              className={clsx(
                'px-2.5 py-2 cursor-pointer border-l-2 flex items-start gap-2',
                isActive ? 'bg-white/[0.06] border-[#666]' : isHovered ? 'bg-white/[0.03] border-transparent' : 'bg-transparent border-transparent'
              )}
            >
              <div className={clsx(
                'w-[7px] h-[7px] rounded-full shrink-0 mt-1 transition-colors duration-200',
                session.status === 'running' ? 'bg-green-400' : 'bg-red-400'
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className={clsx(
                    'text-[13px] overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0',
                    isActive ? 'text-neutral-200 font-medium' : 'text-[#bbb]'
                  )}>
                    {session.aiTitle || session.label}
                  </div>
                  {session.isWorktree && (
                    <span className="text-[8px] text-blue-400 bg-blue-400/[0.12] border border-blue-400/30 rounded-sm px-1 py-px uppercase tracking-[0.05em] shrink-0">
                      wt
                    </span>
                  )}
                </div>
                <div className="text-[#666] text-[10px] overflow-hidden text-ellipsis whitespace-nowrap">
                  {session.cwd}
                </div>
                {summary && (
                  <div className="text-[#666] text-[10px] leading-[1.4] mt-0.5 line-clamp-2 italic">
                    {summary}
                  </div>
                )}
              </div>
              {isHovered && (
                <div
                  onClick={e => { e.stopPropagation(); onClose(session.id) }}
                  className="text-[#777] text-sm leading-none shrink-0 px-0.5"
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
        <div className="shrink-0 border-t border-app-700 px-3 py-2.5 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <div className={clsx(
              'w-[7px] h-[7px] rounded-full shrink-0 transition-colors duration-200',
              selectedSession.status === 'running' ? 'bg-green-400' : 'bg-red-400'
            )} />
            <span className="text-[#ccc] text-xs font-medium">{selectedSession.aiTitle || selectedSession.label}</span>
            <span className="text-[9px] text-[#555] ml-auto uppercase tracking-[0.05em]">
              {selectedSession.status === 'running' ? 'active' : 'idle'}
            </span>
          </div>
          <div className="text-[#555] text-[10px] break-all leading-[1.4]">
            {selectedSession.cwd}
          </div>
          {gitInfo?.branch && (
            <div className="flex items-center gap-[5px]">
              <span className="text-[#555] text-[10px]">⎇</span>
              <span className="text-[#888] text-[10px]">{gitInfo.branch}</span>
              <span className={clsx(
                'text-[8px] rounded-sm px-1 py-px uppercase tracking-[0.05em] border',
                selectedSession.isWorktree
                  ? 'text-blue-400 bg-blue-400/[0.12] border-blue-400/30'
                  : 'text-[#555] bg-white/[0.05] border-app-500'
              )}>
                {selectedSession.isWorktree ? 'worktree' : 'main'}
              </span>
            </div>
          )}
          <ContextBar tokensUsed={tokensUsed} model={model} compact />
          {(summaries[selectedSession.id] || selectedSession.firstPrompt) && (
            <div className={clsx(
              'text-[11px] leading-[1.5] mt-0.5 line-clamp-4',
              summaries[selectedSession.id] ? 'text-[#888] italic' : 'text-[#666]'
            )}>
              {summaries[selectedSession.id] || selectedSession.firstPrompt}
            </div>
          )}
          <div className="text-[#444] text-[10px] font-mono break-all">
            {selectedSession.id}
          </div>
          <button
            onClick={() => onFork(selectedSession.id)}
            className="mt-1 bg-white/[0.05] border border-app-500 rounded text-[#888] text-[11px] cursor-pointer px-2 py-[3px] self-start"
          >
            Fork session
          </button>
        </div>
      )}

      {/* Footer */}
      <div
        onClick={onNewSession}
        className="px-3 py-2 border-t border-app-700 cursor-pointer text-[#777] text-xs flex items-center gap-1.5 shrink-0"
      >
        <span className="text-green-400 text-[13px]">+</span>
        New session
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-[9999] bg-app-750 border border-app-400 rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.6)] p-1 min-w-[160px]"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <SidebarCtxItem onClick={() => { setCtxMenu(null); onRegenerateTitle(ctxMenu.id) }}>
            Regenerate title
          </SidebarCtxItem>
          <SidebarCtxItem onClick={() => { setCtxMenu(null); regenerateSummary(ctxMenu.id) }}>
            Regenerate summary
          </SidebarCtxItem>
          <SidebarCtxItem onClick={() => { setCtxMenu(null); onFork(ctxMenu.id) }}>
            Fork session
          </SidebarCtxItem>
          <div className="h-px bg-app-500 my-[3px]" />
          <SidebarCtxItem danger onClick={() => { setCtxMenu(null); onClose(ctxMenu.id) }}>
            Close session
          </SidebarCtxItem>
        </div>
      )}
    </div>
  )
}

function SidebarCtxItem({ children, onClick, danger }: {
  children: React.ReactNode
  onClick: () => void
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
