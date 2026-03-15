import React, { useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
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
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-20 bg-black/55"
      onClick={onClose}
    >
      <div
        className="bg-app-750 border border-app-400 rounded-[10px] w-[480px] max-h-[420px] shadow-[0_16px_48px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Switch to session…"
          className="bg-transparent border-0 border-b border-app-500 outline-none text-neutral-200 text-sm px-4 py-3.5"
        />

        <div className="overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-5 text-[#555] text-[13px] text-center">No sessions match</div>
          )}
          {filtered.map((s, i) => (
            <div
              key={s.id}
              onClick={() => commit(s)}
              onMouseEnter={() => setIdx(i)}
              className={clsx(
                'flex items-center gap-2.5 px-4 py-[9px] cursor-pointer border-l-2',
                i === idx ? 'bg-white/[0.07] border-green-400' : 'bg-transparent border-transparent'
              )}
            >
              <span className={clsx(
                'w-[7px] h-[7px] rounded-full shrink-0',
                s.type === 'shell'
                  ? s.status === 'running' ? 'bg-blue-400' : 'bg-slate-500'
                  : s.status === 'running' ? 'bg-green-400' : 'bg-red-400',
              )} />
              <div className="flex-1 overflow-hidden">
                <div className={clsx(
                  'text-[13px] overflow-hidden text-ellipsis whitespace-nowrap',
                  s.id === activeId ? 'text-white' : 'text-[#ccc]'
                )}>
                  {s.pinned && <span className="text-gold mr-1 text-[10px]">★</span>}
                  {s.label}
                </div>
                <div className="text-[#555] text-[11px] overflow-hidden text-ellipsis whitespace-nowrap mt-px">
                  {s.cwd}
                </div>
              </div>
              {s.type === 'shell' && (
                <span className="text-blue-400 text-[10px] font-mono">$</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
