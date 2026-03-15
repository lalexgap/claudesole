import React, { useRef, useState, useEffect, useCallback } from 'react'
import { useTerminal, TerminalHandle } from '../hooks/useTerminal'

interface TerminalViewProps {
  sessionId: string
  isActive: boolean
  isShell?: boolean
  onCmdK?: () => void
}

export function TerminalView({ sessionId, isActive, isShell, onCmdK }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<TerminalHandle | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const openSearch = useCallback(() => {
    setShowSearch(true)
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [])

  const closeSearch = useCallback(() => {
    setShowSearch(false)
    setSearchQuery('')
  }, [])

  useTerminal(sessionId, containerRef, openSearch, onCmdK ?? (() => {}), handleRef, isShell, isActive)

  // Scroll to bottom whenever this terminal becomes the active one
  useEffect(() => {
    if (isActive) handleRef.current?.scrollToBottom()
  }, [isActive])

  // Only handle search keys when this tab is active
  useEffect(() => {
    if (!isActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'f') { e.preventDefault(); openSearch() }
      if (e.key === 'Escape' && showSearch) { e.preventDefault(); closeSearch() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, showSearch, openSearch, closeSearch])

  const handleSearchChange = (q: string) => {
    setSearchQuery(q)
    if (q) handleRef.current?.findNext(q)
  }

  const handleSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.shiftKey
        ? handleRef.current?.findPrevious(searchQuery)
        : handleRef.current?.findNext(searchQuery)
    }
    if (e.key === 'Escape') closeSearch()
  }

  return (
    <div className="relative w-full h-full p-2 box-border">
      <div ref={containerRef} className="w-full h-full" />

      {showSearch && (
        <div className="absolute top-4 right-6 bg-app-750 border border-app-350 rounded-md flex items-center gap-1 px-2 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.5)] z-10">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Find…"
            className="bg-transparent border-0 outline-none text-neutral-200 text-[13px] w-[180px]"
          />
          <button
            onClick={() => handleRef.current?.findPrevious(searchQuery)}
            className="bg-transparent border-0 text-[#888] cursor-pointer text-[13px] px-[3px] leading-none"
            title="Previous (⇧↵)"
          >↑</button>
          <button
            onClick={() => handleRef.current?.findNext(searchQuery)}
            className="bg-transparent border-0 text-[#888] cursor-pointer text-[13px] px-[3px] leading-none"
            title="Next (↵)"
          >↓</button>
          <button
            onClick={closeSearch}
            className="bg-transparent border-0 text-[#666] cursor-pointer text-[13px] px-[3px] leading-none ml-0.5"
          >×</button>
        </div>
      )}
    </div>
  )
}
