import { useState, useEffect, useCallback } from 'react'
import { useSessionsStore } from './store/sessions'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { NewSessionModal, SessionOpts } from './components/NewSessionModal'
import { SessionSidebar } from './components/SessionSidebar'
import { SessionHistoryPanel } from './components/SessionHistoryPanel'
import { SplitView, PaneNode, splitLeaf, removeFromTree, getLeafIds } from './components/SplitView'
import { QuickSwitcher } from './components/QuickSwitcher'
import { WorktreePanel } from './components/WorktreePanel'
import { ClaudeSession } from './types/ipc'

export default function App() {
  const { sessions, activeId, addSession, removeSession, setActive, renameSession, togglePin } = useSessionsStore()
  const [showModal, setShowModal] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(false)

  // Map from primary session ID → pane tree for that tab's split layout
  const [paneRoots, setPaneRoots] = useState<Map<string, PaneNode>>(new Map())
  // Map from primary session ID → currently focused session ID within that tab
  const [focusedPanes, setFocusedPanes] = useState<Map<string, string>>(new Map())

  // Derive the active tab's pane root and focused pane ID
  const activePaneRoot = activeId ? (paneRoots.get(activeId) ?? null) : null
  const activeFocusedId = activeId ? (focusedPanes.get(activeId) ?? activeId) : null

  // Compute which sessions are "secondary" (in a split but not the owner/primary)
  const allSplitLeafIds = new Set([...paneRoots.values()].flatMap(root => getLeafIds(root)))
  const splitPrimaryIds = new Set(paneRoots.keys())
  const splitSecondaryIds = new Set([...allSplitLeafIds].filter(id => !splitPrimaryIds.has(id)))

  // Only show non-secondary sessions in the tab bar
  const tabSessions = sessions.filter(s => !splitSecondaryIds.has(s.id))

  const openModal = () => setShowModal(true)
  const closeModal = () => setShowModal(false)
  const toggleSidebar = () => setShowSidebar(v => !v)
  const toggleHistory = () => setShowHistory(v => !v)
  const toggleWorktrees = () => setShowWorktrees(v => !v)

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
    const sessionId = addSession(session.cwd, session.firstPrompt, undefined, session.sessionId)
    window.electronAPI.createSession(sessionId, session.cwd, session.sessionId, skipPermissions, worktree)
    closeModal()
    if (pendingSplit) handleSplitWithNew(sessionId)
  }

  const handleNewInFolder = (cwd: string, { skipPermissions, worktree }: SessionOpts) => {
    const sessionId = addSession(cwd)
    window.electronAPI.createSession(sessionId, cwd, undefined, skipPermissions, worktree)
    closeModal()
    if (pendingSplit) handleSplitWithNew(sessionId)
  }

  const handleBrowse = async ({ skipPermissions, worktree }: SessionOpts) => {
    const cwd = await window.electronAPI.openDirectory()
    if (!cwd) return
    const sessionId = addSession(cwd)
    window.electronAPI.createSession(sessionId, cwd, undefined, skipPermissions, worktree)
    closeModal()
    if (pendingSplit) handleSplitWithNew(sessionId)
  }

  const handleCloseTab = useCallback((id: string) => {
    const session = sessions.find(s => s.id === id)
    if (session?.status === 'running') {
      const ok = window.confirm(`Close "${session.label}"? Claude may still be running.`)
      if (!ok) return
    }

    // If this session has a split, also close all secondary sessions in it
    const root = paneRoots.get(id)
    if (root) {
      const leafIds = getLeafIds(root).filter(leafId => leafId !== id)
      leafIds.forEach(leafId => {
        window.electronAPI.killSession(leafId)
        removeSession(leafId)
      })
      setPaneRoots(prev => { const m = new Map(prev); m.delete(id); return m })
      setFocusedPanes(prev => { const m = new Map(prev); m.delete(id); return m })
    }

    // Also check if this session is a secondary in someone else's split — remove it from there
    for (const [primaryId, primaryRoot] of paneRoots) {
      if (primaryId !== id && getLeafIds(primaryRoot).includes(id)) {
        const newRoot = removeFromTree(primaryRoot, id)
        if (!newRoot || newRoot.type === 'leaf') {
          setPaneRoots(prev => { const m = new Map(prev); m.delete(primaryId); return m })
          setFocusedPanes(prev => { const m = new Map(prev); m.delete(primaryId); return m })
        } else {
          setPaneRoots(prev => new Map([...prev, [primaryId, newRoot]]))
        }
      }
    }

    window.electronAPI.killSession(id)
    removeSession(id)
  }, [sessions, paneRoots, removeSession])

  const [pendingSplit, setPendingSplit] = useState<{ sourceId: string; dir: 'h' | 'v' } | null>(null)

  const handleSplit = (id: string, dir: 'h' | 'v') => {
    const primaryId = activeId
    if (!primaryId) return
    const focusedId = focusedPanes.get(primaryId) ?? primaryId
    if (focusedId === id) {
      // Splitting with self — open session picker
      setPendingSplit({ sourceId: primaryId, dir })
      setShowModal(true)
      return
    }
    const currentRoot = paneRoots.get(primaryId) ?? { type: 'leaf' as const, sessionId: primaryId }
    const newRoot = !paneRoots.has(primaryId)
      ? { type: 'split' as const, dir, ratio: 0.5, first: { type: 'leaf' as const, sessionId: focusedId }, second: { type: 'leaf' as const, sessionId: id } }
      : splitLeaf(currentRoot, focusedId, dir, id)
    setPaneRoots(prev => new Map([...prev, [primaryId, newRoot]]))
    setFocusedPanes(prev => new Map([...prev, [primaryId, id]]))
    setActive(id)
  }

  const handleSplitWithNew = (newId: string) => {
    if (!pendingSplit) return
    const { sourceId, dir } = pendingSplit
    setPendingSplit(null)
    const currentRoot = paneRoots.get(sourceId) ?? { type: 'leaf' as const, sessionId: sourceId }
    const focusedId = focusedPanes.get(sourceId) ?? sourceId
    const newRoot = !paneRoots.has(sourceId)
      ? { type: 'split' as const, dir, ratio: 0.5, first: { type: 'leaf' as const, sessionId: sourceId }, second: { type: 'leaf' as const, sessionId: newId } }
      : splitLeaf(currentRoot, focusedId, dir, newId)
    setPaneRoots(prev => new Map([...prev, [sourceId, newRoot]]))
    setFocusedPanes(prev => new Map([...prev, [sourceId, newId]]))
    setActive(newId)
  }

  const handlePaneFocus = (id: string) => {
    if (!activeId) return
    setFocusedPanes(prev => new Map([...prev, [activeId, id]]))
  }

  const handleNewShellInCwd = (cwd: string) => {
    const sessionId = addSession(cwd, '', undefined, undefined, 'shell')
    window.electronAPI.createShellSession(sessionId, cwd)
    closeModal()
    if (pendingSplit) handleSplitWithNew(sessionId)
  }

  const handleShellBrowse = async () => {
    const cwd = await window.electronAPI.openDirectory()
    if (!cwd) return
    handleNewShellInCwd(cwd)
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
      if (e.key === 'k') { e.preventDefault(); setShowSwitcher(v => !v); return }
      if (e.key === 'G' && e.shiftKey) { e.preventDefault(); toggleWorktrees(); return }

      if (e.key === 'Escape' && showSwitcher) { e.preventDefault(); setShowSwitcher(false); return }

      if (e.key === 'w' && !showModal && !showHistory) {
        e.preventDefault()
        if (activeId) handleCloseTab(activeId)
        return
      }

      const n = parseInt(e.key)
      if (n >= 1 && n <= 9) {
        e.preventDefault()
        const sorted = [...tabSessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
        const target = sorted[n - 1]
        if (target) setActive(target.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, tabSessions, showModal, showHistory, showSwitcher, showWorktrees, handleCloseTab])

  // Determine which session IDs are in the active split (if any)
  const activeSplitLeafIds = activePaneRoot ? new Set(getLeafIds(activePaneRoot)) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <TabBar
        sessions={tabSessions}
        allSessions={sessions}
        paneRoots={paneRoots}
        activeId={activeId}
        onSelectTab={(id) => {
            setActive(id)
          }}
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
        worktreesOpen={showWorktrees}
        onToggleWorktrees={toggleWorktrees}
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

          {activePaneRoot ? (
            <>
              {/* Keep sessions not in the active split alive offscreen (single sessions + secondary sessions of other tabs) */}
              {sessions.filter(s => !activeSplitLeafIds!.has(s.id)).map(s => (
                <div key={s.id} style={{ position: 'absolute', left: '-9999px', top: 0, width: '800px', height: '600px' }}>
                  <TerminalView sessionId={s.id} isActive={false} isShell={s.type === 'shell'} onCmdK={() => setShowSwitcher(true)} />
                </div>
              ))}
              {/* Split layout for the active tab */}
              <div style={{ position: 'absolute', inset: 0 }}>
                <SplitView node={activePaneRoot} sessions={sessions} focusedId={activeFocusedId} onFocus={handlePaneFocus} onCmdK={() => setShowSwitcher(true)} />
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
                  onCmdK={() => setShowSwitcher(true)}
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

          {showWorktrees && (
            <WorktreePanel
              sessions={sessions}
              onOpenSession={(cwd) => {
                const sessionId = addSession(cwd)
                window.electronAPI.createSession(sessionId, cwd, undefined, true, false)
                setShowWorktrees(false)
              }}
              onClose={() => setShowWorktrees(false)}
            />
          )}
        </div>
      </div>

      {showModal && (
        <NewSessionModal
          onResume={handleResume}
          onNewInFolder={handleNewInFolder}
          onBrowse={handleBrowse}
          onNewShell={handleNewShellInCwd}
          onShellBrowse={handleShellBrowse}
          onClose={closeModal}
        />
      )}

      {showSwitcher && (
        <QuickSwitcher
          sessions={sessions}
          activeId={activeId}
          onSelect={setActive}
          onClose={() => setShowSwitcher(false)}
        />
      )}
    </div>
  )
}
