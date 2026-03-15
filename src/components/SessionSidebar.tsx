import React, { useState, useEffect } from 'react'
import clsx from 'clsx'
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

  const selectedSession = sessions.find(s => s.id === activeId)

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
    <div className="w-[220px] shrink-0 bg-app-850 border-r border-app-650 flex flex-col overflow-hidden">
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

          return (
            <div
              key={session.id}
              onClick={() => onSelect(session.id)}
              onMouseEnter={() => setHovered(session.id)}
              onMouseLeave={() => setHovered(null)}
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
                <div className={clsx(
                  'text-[13px] overflow-hidden text-ellipsis whitespace-nowrap',
                  isActive ? 'text-neutral-200 font-medium' : 'text-[#bbb]'
                )}>
                  {session.label}
                </div>
                {session.isWorktree && (
                  <span className="text-[8px] text-blue-400 bg-blue-400/[0.12] border border-blue-400/30 rounded-sm px-1 py-px uppercase tracking-[0.05em] self-start">
                    wt
                  </span>
                )}
                <div className="text-[#666] text-[10px] overflow-hidden text-ellipsis whitespace-nowrap">
                  {session.cwd}
                </div>
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
            <span className="text-[#ccc] text-xs font-medium">{selectedSession.label}</span>
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
                gitInfo.isWorktree
                  ? 'text-blue-400 bg-blue-400/[0.12] border-blue-400/30'
                  : 'text-[#555] bg-white/[0.05] border-app-500'
              )}>
                {gitInfo.isWorktree ? 'worktree' : 'main'}
              </span>
            </div>
          )}
          <ContextBar tokensUsed={tokensUsed} compact />
          {selectedSession.firstPrompt && (
            <div
              className="text-[#666] text-[11px] leading-[1.5] mt-0.5 line-clamp-4"
            >
              {selectedSession.firstPrompt}
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
    </div>
  )
}
