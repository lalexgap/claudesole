import { useState, useEffect } from 'react'
import { useSessionsStore } from './store/sessions'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { NewSessionModal, SessionOpts } from './components/NewSessionModal'
import { SessionSidebar } from './components/SessionSidebar'
import { SessionHistoryPanel } from './components/SessionHistoryPanel'
import { SplitView, PaneNode, splitLeaf, removeFromTree, getLeafIds } from './components/SplitView'
import { ClaudeSession } from './types/ipc'

export default function App() {
  const { sessions, activeId, addSession, removeSession, setActive, renameSession, togglePin } = useSessionsStore()
  const [showModal, setShowModal] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [paneRoot, setPaneRoot] = useState<PaneNode | null>(null)
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null)

  const openModal = () => setShowModal(true)
  const closeModal = () => setShowModal(false)
  const toggleSidebar = () => setShowSidebar(v => !v)
  const toggleHistory = () => setShowHistory(v => !v)

  // Auto-open modal on launch
  useEffect(() => {
    if (sessions.length === 0) setShowModal(true)
  }, [])

  // Dock badge — only Claude sessions (shell idle is not actionable)
  useEffect(() => {
    const waiting = sessions.filter(s => s.type === 'claude' && s.status === 'waiting').length
    window.electronAPI?.setBadgeCount?.(waiting)
  }, [sessions])

  const handleResume = (session: ClaudeSession, { skipPermissions, worktree }: SessionOpts) => {
    // Store the Claude session ID so fork can use it later
    const sessionId = addSession(session.cwd, session.firstPrompt, undefined, session.sessionId)
    window.electronAPI.createSession(sessionId, session.cwd, session.sessionId, skipPermissions, worktree)
    closeModal()
  }

  const handleNewInFolder = (cwd: string, { skipPermissions, worktree }: SessionOpts) => {
    const sessionId = addSession(cwd)
    window.electronAPI.createSession(sessionId, cwd, undefined, skipPermissions, worktree)
    closeModal()
  }

  const handleBrowse = async ({ skipPermissions, worktree }: SessionOpts) => {
    const cwd = await window.electronAPI.openDirectory()
    if (!cwd) return
    const sessionId = addSession(cwd)
    window.electronAPI.createSession(sessionId, cwd, undefined, skipPermissions, worktree)
    closeModal()
  }

  const handleCloseTab = (id: string) => {
    const session = sessions.find(s => s.id === id)
    if (session?.status === 'running') {
      const ok = window.confirm(`Close "${session.label}"? Claude may still be running.`)
      if (!ok) return
    }
    window.electronAPI.killSession(id)
    removeSession(id)
    // Remove from split tree
    setPaneRoot(prev => {
      if (!prev) return null
      const next = removeFromTree(prev, id)
      if (!next || next.type === 'leaf') {
        // Collapsed to one or zero panes — exit split mode
        setFocusedPaneId(next?.sessionId ?? null)
        return null
      }
      if (focusedPaneId === id) {
        setFocusedPaneId(getLeafIds(next)[0] ?? null)
      }
      return next
    })
  }

  const handleSplit = (id: string, dir: 'h' | 'v') => {
    const focusedId = paneRoot ? focusedPaneId : activeId
    if (!focusedId || focusedId === id) return
    if (paneRoot === null) {
      setPaneRoot({ type: 'split', dir, ratio: 0.5, first: { type: 'leaf', sessionId: focusedId }, second: { type: 'leaf', sessionId: id } })
    } else {
      setPaneRoot(prev => prev ? splitLeaf(prev, focusedId, dir, id) : { type: 'leaf', sessionId: id })
    }
    setFocusedPaneId(id)
    setActive(id)
  }

  const handlePaneFocus = (id: string) => {
    setFocusedPaneId(id)
    setActive(id)
  }

  const handleNewShellTab = async () => {
    const active = sessions.find(s => s.id === activeId)
    const cwd = active?.cwd ?? await window.electronAPI.openDirectory()
    if (!cwd) return
    const sessionId = addSession(cwd, '', undefined, undefined, 'shell')
    window.electronAPI.createShellSession(sessionId, cwd)
  }

  const handleForkTab = async (id: string) => {
    const session = sessions.find(s => s.id === id)
    if (!session) return

    // Use the stored Claude session ID, or find the latest one for this cwd
    let claudeId = session.claudeSessionId
    if (!claudeId) {
      claudeId = await window.electronAPI.latestSessionForCwd(session.cwd) ?? undefined
    }

    const newId = addSession(session.cwd, session.firstPrompt, session.label)
    // Pass resumeSessionId + forkSession=true → claude --resume <id> --fork-session
    window.electronAPI.createSession(newId, session.cwd, claudeId, true, false, true)
  }

  // History panel: resume session with default opts
  const handleHistoryResume = (session: ClaudeSession, skipPermissions: boolean) => {
    const sessionId = addSession(session.cwd, session.firstPrompt, undefined, session.sessionId)
    window.electronAPI.createSession(sessionId, session.cwd, session.sessionId, skipPermissions, false)
    setShowHistory(false)
  }

  // History panel: fork session
  const handleHistoryFork = (session: ClaudeSession, skipPermissions: boolean) => {
    const newId = addSession(session.cwd, session.firstPrompt, undefined, session.sessionId)
    window.electronAPI.createSession(newId, session.cwd, session.sessionId, skipPermissions, false, true)
    setShowHistory(false)
  }

  useEffect(() => {
    if (!window.electronAPI) return
    return window.electronAPI.onShortcutNewSession(openModal)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return

      if (e.key === 'b') { e.preventDefault(); toggleSidebar(); return }
      if (e.key === 'h') { e.preventDefault(); toggleHistory(); return }

      if (e.key === 'w' && !showModal && !showHistory) {
        e.preventDefault()
        if (activeId) handleCloseTab(activeId)
        return
      }

      const n = parseInt(e.key)
      if (n >= 1 && n <= 9) {
        e.preventDefault()
        const sorted = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
        const target = sorted[n - 1]
        if (target) setActive(target.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, sessions, showModal, showHistory])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <TabBar
        sessions={sessions}
        activeId={activeId}
        onSelectTab={setActive}
        onCloseTab={handleCloseTab}
        onNewTab={openModal}
        onNewShellTab={handleNewShellTab}
        onRenameTab={renameSession}
        onPinTab={togglePin}
        onForkTab={handleForkTab}
        onSplitHTab={(id) => handleSplit(id, 'h')}
        onSplitVTab={(id) => handleSplit(id, 'v')}
        historyOpen={showHistory}
        onToggleHistory={toggleHistory}
        sidebarOpen={showSidebar}
        onToggleSidebar={toggleSidebar}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {showSidebar && (
          <SessionSidebar
            sessions={sessions.filter(s => s.type === 'claude')}
            activeId={activeId}
            onSelect={setActive}
            onClose={handleCloseTab}
            onFork={handleForkTab}
            onNewSession={openModal}
          />
        )}

        <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
          {sessions.length === 0 && !showHistory && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#333', fontSize: '14px',
            }}>
              Press ⌘T or click + to open a session
            </div>
          )}

          {paneRoot ? (
            <>
              {/* Keep non-visible sessions alive offscreen so xterm state is preserved */}
              {sessions.filter(s => !getLeafIds(paneRoot).includes(s.id)).map(s => (
                <div key={s.id} style={{ position: 'absolute', left: '-9999px', top: 0, width: '800px', height: '600px' }}>
                  <TerminalView sessionId={s.id} isActive={false} isShell={s.type === 'shell'} />
                </div>
              ))}
              {/* Split layout */}
              <div style={{ position: 'absolute', inset: 0 }}>
                <SplitView node={paneRoot} sessions={sessions} focusedId={focusedPaneId} onFocus={handlePaneFocus} />
              </div>
            </>
          ) : (
            sessions.map(session => (
              <div key={session.id} style={{
                position: 'absolute', inset: 0,
                visibility: session.id === activeId && !showHistory ? 'visible' : 'hidden',
              }}>
                <TerminalView
                  sessionId={session.id}
                  isActive={session.id === activeId && !showHistory}
                  isShell={session.type === 'shell'}
                />
              </div>
            ))
          )}

          {showHistory && (
            <SessionHistoryPanel
              onResume={handleHistoryResume}
              onFork={handleHistoryFork}
              onClose={() => setShowHistory(false)}
            />
          )}
        </div>
      </div>

      {showModal && (
        <NewSessionModal
          onResume={handleResume}
          onNewInFolder={handleNewInFolder}
          onBrowse={handleBrowse}
          onClose={closeModal}
        />
      )}
    </div>
  )
}
