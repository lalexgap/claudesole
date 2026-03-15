import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSessionsStore } from './store/sessions'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { NewSessionModal, SessionOpts } from './components/NewSessionModal'
import { SessionSidebar } from './components/SessionSidebar'
import { SessionHistoryPanel } from './components/SessionHistoryPanel'
import { PaneNode, splitLeaf, removeFromTree, getLeafIds, computeLayout, updateRatioAtPath, SplitDividers } from './components/SplitView'
import { QuickSwitcher } from './components/QuickSwitcher'
import { WorktreePanel } from './components/WorktreePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ClaudeSession } from './types/ipc'

export default function App() {
  const { sessions, activeId, addSession, removeSession, setActive, renameSession, togglePin, setAiTitle, clearAiTitle } = useSessionsStore()
  const [showModal, setShowModal] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Map from primary session ID → pane tree for that tab's split layout
  const [paneRoots, setPaneRoots] = useState<Map<string, PaneNode>>(new Map())
  // Map from primary session ID → currently focused session ID within that tab
  const [focusedPanes, setFocusedPanes] = useState<Map<string, string>>(new Map())

  // Content area ref + size — used for pixel-accurate split layout
  const contentRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Derive the active tab's pane root and focused pane ID
  const activePaneRoot = activeId ? (paneRoots.get(activeId) ?? null) : null
  const activeFocusedId = activeId ? (focusedPanes.get(activeId) ?? activeId) : null

  // Compute split layout (pixel rects + dividers) when in split mode
  const { splitLayoutMap, splitDividers } = useMemo(() => {
    if (!activePaneRoot || containerSize.w === 0) {
      return { splitLayoutMap: new Map<string, { left: number; top: number; width: number; height: number }>(), splitDividers: [] }
    }
    const { rects, dividers } = computeLayout(activePaneRoot, 0, 0, containerSize.w, containerSize.h)
    return { splitLayoutMap: rects, splitDividers: dividers }
  }, [activePaneRoot, containerSize])

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
  const toggleSettings = () => setShowSettings(v => !v)

  // Auto-open modal on launch
  useEffect(() => {
    if (sessions.length === 0) setShowModal(true)
  }, [])

  // Dock badge — only Claude sessions (shell idle is not actionable)
  useEffect(() => {
    const waiting = sessions.filter(s => s.type === 'claude' && s.status === 'waiting').length
    window.electronAPI?.setBadgeCount?.(waiting)
  }, [sessions])

  const startSession = async (cwd: string, opts: SessionOpts, resumeOpts?: { sessionId: string; firstPrompt: string; claudeSessionId: string }) => {
    let sessionCwd = cwd
    let worktreeArg: boolean | string | undefined = undefined

    if (opts.worktree) {
      if (opts.branch) {
        try {
          sessionCwd = await window.electronAPI.createWorktree(cwd, opts.branch)
        } catch (err) {
          alert(`Failed to create worktree: ${err instanceof Error ? err.message : err}`)
          return ''
        }
      } else {
        worktreeArg = true
      }
    }

    const sessionId = addSession(sessionCwd, resumeOpts?.firstPrompt, undefined, resumeOpts?.claudeSessionId, 'claude', opts.worktree)
    window.electronAPI.createSession(sessionId, sessionCwd, resumeOpts?.claudeSessionId, opts.skipPermissions, worktreeArg)
    return sessionId
  }

  const handleResume = async (session: ClaudeSession, opts: SessionOpts) => {
    const sessionId = await startSession(session.cwd, opts, { sessionId: session.sessionId, firstPrompt: session.firstPrompt, claudeSessionId: session.sessionId })
    closeModal()
    if (pendingSplit && sessionId) handleSplitWithNew(sessionId)
  }

  const handleNewInFolder = async (cwd: string, opts: SessionOpts) => {
    const sessionId = await startSession(cwd, opts)
    closeModal()
    if (pendingSplit && sessionId) handleSplitWithNew(sessionId)
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

  const handleDividerDrag = (path: string, newRatio: number) => {
    if (!activeId) return
    setPaneRoots(prev => {
      const root = prev.get(activeId)
      if (!root) return prev
      return new Map([...prev, [activeId, updateRatioAtPath(root, path, newRatio)]])
    })
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

    let claudeId = session.claudeSessionId
    if (!claudeId) {
      claudeId = await window.electronAPI.latestSessionForCwd(session.cwd) ?? undefined
    }

    const newId = addSession(session.cwd, session.firstPrompt, session.label)
    window.electronAPI.createSession(newId, session.cwd, claudeId, true, false, true)
  }

  const handleHistoryResume = (session: ClaudeSession, skipPermissions: boolean) => {
    const sessionId = addSession(session.cwd, session.firstPrompt, undefined, session.sessionId)
    window.electronAPI.createSession(sessionId, session.cwd, session.sessionId, skipPermissions, false)
    setShowHistory(false)
  }

  const handleHistoryFork = (session: ClaudeSession, skipPermissions: boolean) => {
    const newId = addSession(session.cwd, session.firstPrompt, undefined, session.sessionId)
    window.electronAPI.createSession(newId, session.cwd, session.sessionId, skipPermissions, false, true)
    setShowHistory(false)
  }

  // Top-level exit handler — runs even if the terminal component hasn't mounted yet
  // (prevents blank, undismissable tabs when a session fails immediately)
  useEffect(() => {
    return window.electronAPI.onExit((id) => {
      removeSession(id)
    })
  }, [removeSession])

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
      if (e.key === ',') { e.preventDefault(); toggleSettings(); return }

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
  }, [activeId, tabSessions, showModal, showHistory, showSwitcher, showWorktrees, handleCloseTab, toggleSettings])

  // Generate AI titles for sessions that have just gone "waiting" (Claude responded)
  const titledSessionIds = useRef(new Set<string>())
  useEffect(() => {
    for (const session of sessions) {
      if (session.type !== 'claude') continue
      if (session.status !== 'waiting') continue
      if (session.aiTitle) continue
      if (!session.userHasTyped) continue
      if (titledSessionIds.current.has(session.id)) continue
      titledSessionIds.current.add(session.id)
      const tabId = session.id
      const cwd = session.cwd
      const inMemoryPrompt = session.firstPrompt;
      (async () => {
        let prompt = inMemoryPrompt
        let cacheKey = tabId
        if (!prompt) {
          // New session: firstPrompt not captured in state — read from JSONL on disk
          const latest = await window.electronAPI.getLatestSession(cwd)
          if (!latest?.firstPrompt) return
          prompt = latest.firstPrompt
          cacheKey = latest.sessionId // use Claude UUID so history panel hits the same cache
        }
        const title = await window.electronAPI.generateSessionTitle(cacheKey, prompt)
        if (title) setAiTitle(tabId, title)
      })().catch(() => {})
    }
  }, [sessions, setAiTitle])

  const handleRegenerateTitle = useCallback(async (id: string) => {
    const session = sessions.find(s => s.id === id)
    if (!session) return
    // Clear server-side cache for both possible keys
    await window.electronAPI.clearTitleCache(session.claudeSessionId ?? id)
    await window.electronAPI.clearTitleCache(id)
    // Clear client-side state and re-arm the generation effect
    clearAiTitle(id)
    titledSessionIds.current.delete(id)
  }, [sessions, clearAiTitle])

  return (
    <div className="flex flex-col w-full h-full">
      <TabBar
        sessions={tabSessions}
        allSessions={sessions}
        paneRoots={paneRoots}
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
        onRegenerateTitle={handleRegenerateTitle}
        historyOpen={showHistory}
        onToggleHistory={toggleHistory}
        sidebarOpen={showSidebar}
        onToggleSidebar={toggleSidebar}
        worktreesOpen={showWorktrees}
        onToggleWorktrees={toggleWorktrees}
        settingsOpen={showSettings}
        onToggleSettings={toggleSettings}
      />

      <div className="flex flex-1 overflow-hidden">
        {showSidebar && (
          <SessionSidebar
            sessions={sessions.filter(s => s.type === 'claude')}
            activeId={activeId}
            onSelect={setActive}
            onClose={handleCloseTab}
            onFork={handleForkTab}
            onRegenerateTitle={handleRegenerateTitle}
            onNewSession={openModal}
          />
        )}

        <div ref={contentRef} className="relative flex-1 overflow-hidden">
          {sessions.length === 0 && !showHistory && (
            <div className="absolute inset-0 flex items-center justify-center text-[#333] text-sm">
              Press ⌘T or click + to open a session
            </div>
          )}

          {/* Always render ALL terminals in a stable flat list — never unmounts on tab switch */}
          {sessions.map(session => {
            const splitRect = splitLayoutMap.get(session.id)
            const isNonSplitActive = !activePaneRoot && session.id === activeId && !showHistory
            const isFocused = splitRect !== undefined && session.id === activeFocusedId
            const isVisible = !!splitRect || isNonSplitActive

            let style: React.CSSProperties
            if (splitRect) {
              // In the active split — position using computed pixel rect
              style = {
                position: 'absolute',
                left: splitRect.left,
                top: splitRect.top,
                width: splitRect.width,
                height: splitRect.height,
                outline: isFocused ? '1px solid rgba(74,222,128,0.35)' : '1px solid #1e1e1e',
                outlineOffset: '-1px',
                zIndex: 1,
              }
            } else {
              // Non-split: fill the container. Use visibility (not left:-9999px) so
              // dimensions stay constant and ResizeObserver never fires a spurious resize.
              style = {
                position: 'absolute',
                inset: 0,
                visibility: isNonSplitActive ? 'visible' : 'hidden',
                zIndex: isNonSplitActive ? 1 : 0,
              }
            }

            return (
              <div
                key={session.id}
                style={style}
                onClick={splitRect ? () => handlePaneFocus(session.id) : undefined}
              >
                <TerminalView
                  sessionId={session.id}
                  isActive={isVisible && (isNonSplitActive || isFocused)}
                  isShell={session.type === 'shell'}
                  onCmdK={() => setShowSwitcher(true)}
                />
              </div>
            )
          })}

          {/* Drag dividers overlay — no terminals inside */}
          {activePaneRoot && containerSize.w > 0 && (
            <SplitDividers
              dividers={splitDividers}
              containerRef={contentRef}
              onRatioChange={handleDividerDrag}
            />
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

          {showSettings && (
            <SettingsPanel onClose={() => setShowSettings(false)} />
          )}
        </div>
      </div>

      {showModal && (
        <NewSessionModal
          onResume={handleResume}
          onNewInFolder={handleNewInFolder}
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
