import { useRef, useState, useEffect, useCallback } from 'react'
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

  useTerminal(sessionId, containerRef, openSearch, onCmdK ?? (() => {}), handleRef, isShell)

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
    <div style={{ position: 'relative', width: '100%', height: '100%', padding: '8px', boxSizing: 'border-box' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {showSearch && (
        <div style={{
          position: 'absolute',
          top: '16px',
          right: '24px',
          background: '#222',
          border: '1px solid #3a3a3a',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          zIndex: 10,
        }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKey}
            placeholder="Find…"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e5e5e5',
              fontSize: '13px',
              width: '180px',
            }}
          />
          <button onClick={() => handleRef.current?.findPrevious(searchQuery)}
            style={btnStyle} title="Previous (⇧↵)">↑</button>
          <button onClick={() => handleRef.current?.findNext(searchQuery)}
            style={btnStyle} title="Next (↵)">↓</button>
          <button onClick={closeSearch}
            style={{ ...btnStyle, marginLeft: '2px', color: '#666' }}>×</button>
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  cursor: 'pointer',
  fontSize: '13px',
  padding: '0 3px',
  lineHeight: 1,
}
