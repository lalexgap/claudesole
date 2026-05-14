import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSessionsStore, hydrateEditorSessions, armEditorPersistence } from './store/sessions'
import { TabBar } from './components/TabBar'
import { TerminalView } from './components/TerminalView'
import { Editor, saveEditor } from './components/EditorView'
import { NewSessionModal, SessionOpts } from './components/NewSessionModal'
import { SessionSidebar } from './components/SessionSidebar'
import { FileBrowserPanel } from './components/FileBrowserPanel'
import { SessionHistoryPanel } from './components/SessionHistoryPanel'
import { PaneNode, splitLeaf, removeFromTree, getLeafIds, computeLayout, updateRatioAtPath, SplitDividers } from './components/SplitView'
import { QuickSwitcher } from './components/QuickSwitcher'
import { QuickOpenModal } from './components/QuickOpenModal'
import { WorktreePanel } from './components/WorktreePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ToastStack } from './components/ToastStack'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ChoiceDialog } from './components/ChoiceDialog'
import { toast, confirm, choose } from './store/ui'
import { ClaudeSession, CodexSession } from './types/ipc'
import type { HistorySession } from './components/SessionHistoryPanel'

export default function App() {
  const { sessions, activeId, addSession, addEditorSession, removeSession, setActive, renameSession, togglePin, setAiTitle, clearAiTitle, setBranch } = useSessionsStore()
  const [showModal, setShowModal] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showFiles, setShowFiles] = useState(false)

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
  const toggleFiles = () => setShowFiles(v => !v)

  // Hydrate persisted editor tabs first (silently drop ones whose files are gone),
  // then auto-open the modal only if nothing was restored.
  useEffect(() => {
    let cancelled = false
    const { sessions: persisted, activeId } = hydrateEditorSessions()
    if (persisted.length === 0) {
      armEditorPersistence()
      if (sessions.length === 0) setShowModal(true)
      return
    }
    Promise.all(persisted.map(s =>
      window.electronAPI.fileExists(s.filePath!)
        .then(r => (r.exists && r.isFile) ? s : null)
        .catch(() => null)
    )).then(results => {
      if (cancelled) return
      const valid = results.filter((s): s is typeof persisted[number] => s !== null)
      if (valid.length > 0) {
        useSessionsStore.getState().hydrateEditorTabs(valid, activeId)
      }
      // Arm AFTER injecting hydrated tabs so we don't immediately overwrite
      // localStorage with an empty state during the initial render race.
      armEditorPersistence()
      if (valid.length === 0 && sessions.length === 0) setShowModal(true)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dock badge — only Claude/Codex sessions (shell idle is not actionable)
  useEffect(() => {
    const waiting = sessions.filter(s => (s.type === 'claude' || s.type === 'codex') && s.status === 'waiting').length
    window.electronAPI?.setBadgeCount?.(waiting)
  }, [sessions])

  const startSession = async (cwd: string, opts: SessionOpts, resumeOpts?: { sessionId: string; firstPrompt: string; claudeSessionId: string }) => {
    let sessionCwd = cwd
    let worktreeArg: boolean | string | undefined = undefined

    if (opts.worktree) {
      if (opts.branch) {
        try {
          sessionCwd = await window.electronAPI.createWorktree(cwd, opts.branch, opts.baseBranch)
        } catch (err) {
          toast.error(`Failed to create worktree: ${err instanceof Error ? err.message : err}`)
          return ''
        }
      } else {
        worktreeArg = true
      }
    }

    const gitInfo = await window.electronAPI.getGitInfo(sessionCwd)
    const isWorktree = gitInfo?.isWorktree || opts.worktree || false

    // Dedup: after the await, atomically check if a concurrent call already created this session
    if (resumeOpts?.claudeSessionId) {
      const existing = useSessionsStore.getState().sessions.find(s => s.claudeSessionId === resumeOpts.claudeSessionId)
      if (existing) {
        setActive(existing.id)
        return existing.id
      }
    }

    const sessionId = addSession(sessionCwd, resumeOpts?.firstPrompt, undefined, resumeOpts?.claudeSessionId, 'claude', isWorktree)
    if (gitInfo?.branch) setBranch(sessionId, gitInfo.branch)
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

  const startCodexSession = async (cwd: string, opts: SessionOpts, resumeOpts?: { firstPrompt: string; codexSessionId: string; forkSession?: boolean }) => {
    let sessionCwd = cwd
    if (opts.worktree && opts.branch) {
      try {
        sessionCwd = await window.electronAPI.createWorktree(cwd, opts.branch)
      } catch (err) {
        toast.error(`Failed to create worktree: ${err instanceof Error ? err.message : err}`)
        return ''
      }
    }

    const gitInfo = await window.electronAPI.getGitInfo(sessionCwd)
    const isWorktree = gitInfo?.isWorktree || opts.worktree || false

    if (resumeOpts?.codexSessionId) {
      const existing = useSessionsStore.getState().sessions.find(s => s.codexSessionId === resumeOpts.codexSessionId)
      if (existing) {
        setActive(existing.id)
        return existing.id
      }
    }

    const sessionId = addSession(sessionCwd, resumeOpts?.firstPrompt, undefined, undefined, 'codex', isWorktree, resumeOpts?.codexSessionId)
    if (gitInfo?.branch) setBranch(sessionId, gitInfo.branch)
    window.electronAPI.createCodexSession(sessionId, sessionCwd, resumeOpts?.codexSessionId, opts.skipPermissions, resumeOpts?.forkSession)
    return sessionId
  }

  const handleResumeCodex = async (session: CodexSession, opts: SessionOpts) => {
    const sessionId = await startCodexSession(session.cwd, opts, { firstPrompt: session.firstPrompt, codexSessionId: session.sessionId })
    closeModal()
    if (pendingSplit && sessionId) handleSplitWithNew(sessionId)
  }

  const handleNewCodexInFolder = async (cwd: string, opts: SessionOpts) => {
    const sessionId = await startCodexSession(cwd, opts)
    closeModal()
    if (pendingSplit && sessionId) handleSplitWithNew(sessionId)
  }

  const openFileInEditor = useCallback((filePath: string, cwd: string) => {
    // If the file is already open in an editor tab, just focus it.
    const existing = sessions.find(s => s.type === 'editor' && s.filePath === filePath)
    if (existing) {
      setActive(existing.id)
      return existing.id
    }
    return addEditorSession(filePath, cwd)
  }, [sessions, setActive, addEditorSession])

  const handleCloseTab = useCallback(async (id: string) => {
    const session = sessions.find(s => s.id === id)
    if (session?.type === 'editor' && session.isDirty) {
      const choice = await choose({
        title: 'Save changes?',
        message: `"${session.label}" has unsaved changes.`,
        primaryLabel: 'Save',
        altLabel: "Don't save",
        cancelLabel: 'Cancel',
        defaultButton: 'primary',
      })
      if (choice === 'cancel') return
      if (choice === 'primary') {
        try { await saveEditor(id) } catch { return }
      }
    } else if (session?.type !== 'editor' && session?.status === 'running') {
      const ok = await confirm({
        title: 'Close session?',
        message: `"${session.label}" may still be running.`,
        confirmLabel: 'Close',
        tone: 'danger',
      })
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
  const [paneCtxMenu, setPaneCtxMenu] = useState<{ x: number; y: number; paneId: string } | null>(null)

  const handlePaneContextMenu = (e: React.MouseEvent, paneId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setPaneCtxMenu({ x: e.clientX, y: e.clientY, paneId })
  }

  // Close a single pane within a split (or fall through to the regular tab
  // close for a non-split session). If the primary of a split is closed, a
  // remaining leaf is promoted to primary so the split tree stays intact.
  const handleClosePane = async (paneId: string) => {
    let primaryId: string | null = null
    for (const [pid, root] of paneRoots) {
      if (getLeafIds(root).includes(paneId)) { primaryId = pid; break }
    }
    if (!primaryId) { handleCloseTab(paneId); return }

    const session = sessions.find(s => s.id === paneId)
    if (session?.status === 'running') {
      const ok = await confirm({
        title: 'Close pane?',
        message: `"${session.label}" may still be running.`,
        confirmLabel: 'Close',
        tone: 'danger',
      })
      if (!ok) return
    }

    const root = paneRoots.get(primaryId)
    const newRoot = root ? removeFromTree(root, paneId) : null
    const closingPrimary = paneId === primaryId

    if (!newRoot || newRoot.type === 'leaf') {
      setPaneRoots(prev => { const m = new Map(prev); m.delete(primaryId!); return m })
      setFocusedPanes(prev => { const m = new Map(prev); m.delete(primaryId!); return m })
      if (closingPrimary && newRoot?.type === 'leaf') setActive(newRoot.sessionId)
    } else if (closingPrimary) {
      // Primary got closed but split survives — promote leftmost remaining leaf.
      const newPrimaryId = getLeafIds(newRoot)[0]
      setPaneRoots(prev => {
        const m = new Map(prev)
        m.delete(primaryId!)
        m.set(newPrimaryId, newRoot)
        return m
      })
      setFocusedPanes(prev => {
        const m = new Map(prev)
        m.delete(primaryId!)
        m.set(newPrimaryId, newPrimaryId)
        return m
      })
      setActive(newPrimaryId)
    } else {
      setPaneRoots(prev => new Map([...prev, [primaryId!, newRoot]]))
      if ((focusedPanes.get(primaryId!) ?? primaryId) === paneId) {
        setFocusedPanes(prev => new Map([...prev, [primaryId!, getLeafIds(newRoot)[0]]]))
      }
    }

    window.electronAPI.killSession(paneId)
    removeSession(paneId)
  }

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
    // Stay on the primary tab — paneRoots is keyed by primaryId, so switching
    // activeId to the secondary pane would leave the split unrendered.
    setActive(primaryId)
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
    // Stay on the primary tab — the new session is a secondary pane, so
    // activeId must remain the source to index into paneRoots correctly.
    setActive(sourceId)
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

  const handleHistoryResume = (session: HistorySession, skipPermissions: boolean) => {
    if (session.source === 'codex') {
      const sessionId = addSession(session.cwd, session.firstPrompt, undefined, undefined, 'codex', false, session.sessionId)
      window.electronAPI.createCodexSession(sessionId, session.cwd, session.sessionId, skipPermissions, false)
      setShowHistory(false)
      return
    }

    const sessionId = addSession(session.cwd, session.firstPrompt, undefined, session.sessionId)
    window.electronAPI.createSession(sessionId, session.cwd, session.sessionId, skipPermissions, false)
    setShowHistory(false)
  }

  const handleHistoryFork = (session: HistorySession, skipPermissions: boolean) => {
    if (session.source === 'codex') {
      const newId = addSession(session.cwd, session.firstPrompt, undefined, undefined, 'codex', false, session.sessionId)
      window.electronAPI.createCodexSession(newId, session.cwd, session.sessionId, skipPermissions, true)
      setShowHistory(false)
      return
    }

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

  // Native files dropped from Finder open in editor tabs. Electron 29 still
  // exposes `File.path` on the dropped File, so no IPC roundtrip needed.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return
      e.preventDefault()
      const id = activeFocusedId ?? activeId
      const cwd = sessions.find(s => s.id === id)?.cwd
      if (!cwd) return
      for (const file of Array.from(files)) {
        const filePath = (file as File & { path?: string }).path
        if (!filePath) continue
        openFileInEditor(filePath, cwd)
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [sessions, activeId, activeFocusedId, openFileInEditor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return

      if (e.key === 'b') { e.preventDefault(); toggleSidebar(); return }
      if (e.key === 'h') { e.preventDefault(); toggleHistory(); return }
      if (e.key === 'k') { e.preventDefault(); setShowSwitcher(v => !v); return }
      if (e.key === 'p') { e.preventDefault(); setShowQuickOpen(v => !v); return }
      if (e.key === 'G' && e.shiftKey) { e.preventDefault(); toggleWorktrees(); return }
      if (e.key === ',') { e.preventDefault(); toggleSettings(); return }
      if (e.key === 'e') { e.preventDefault(); toggleFiles(); return }

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

  // Generate AI titles for sessions that have just gone "waiting" (Claude responded).
  // Re-generate every REGEN_INTERVAL so the title reflects the latest conversation.
  const titledSessionIds = useRef(new Set<string>())
  const lastRegenerateRef = useRef<Record<string, number>>({})
  const REGEN_INTERVAL_MS = 5 * 60 * 1000

  useEffect(() => {
    for (const session of sessions) {
      if (session.type !== 'claude' && session.type !== 'codex') continue
      if (session.status !== 'waiting') continue
      if (session.aiTitle) continue
      const prompt = session.firstPrompt
      if (!prompt) continue
      if (titledSessionIds.current.has(session.id)) continue
      titledSessionIds.current.add(session.id)
      const tabId = session.id
      const claudeId = session.claudeSessionId
      const cwd = session.cwd;
      (async () => {
        const title = await window.electronAPI.generateSessionTitle(tabId, prompt, undefined, claudeId, cwd)
        if (title) {
          setAiTitle(tabId, title)
          lastRegenerateRef.current[tabId] = Date.now()
        }
      })().catch(() => {})
    }
  }, [sessions, setAiTitle])

  // Periodic refresh: re-generate titles using the latest prompt from disk.
  useEffect(() => {
    const tick = async () => {
      const current = useSessionsStore.getState().sessions
      for (const session of current) {
        if (session.type !== 'claude' && session.type !== 'codex') continue
        if (!session.firstPrompt) continue
        const last = lastRegenerateRef.current[session.id] ?? 0
        if (Date.now() - last < REGEN_INTERVAL_MS) continue
        lastRegenerateRef.current[session.id] = Date.now()
        try {
          const target = session.claudeSessionId
            ? await window.electronAPI.getSessionById(session.claudeSessionId)
            : await window.electronAPI.getLatestSession(session.cwd)
          const latestPrompt = target?.latestPrompt || undefined
          await window.electronAPI.clearTitleCache(session.claudeSessionId ?? session.id)
          await window.electronAPI.clearTitleCache(session.id)
          const title = await window.electronAPI.generateSessionTitle(session.id, session.firstPrompt, latestPrompt, session.claudeSessionId, session.cwd)
          if (title) setAiTitle(session.id, title)
        } catch {}
      }
    }
    const interval = setInterval(tick, 60 * 1000)
    return () => clearInterval(interval)
  }, [setAiTitle])

  // Keep each session's branch label fresh — refetched on creation and every 30s
  // so tab labels follow `git checkout` in the underlying worktree.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const current = useSessionsStore.getState().sessions
      for (const session of current) {
        try {
          const info = await window.electronAPI.getGitInfo(session.cwd)
          if (cancelled) return
          const next = info?.branch ?? null
          if (next !== (session.branch ?? null)) setBranch(session.id, next)
        } catch {}
      }
    }
    refresh()
    const interval = setInterval(refresh, 30 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [sessions.length, setBranch])

  const handleRegenerateTitle = useCallback(async (id: string) => {
    const session = sessions.find(s => s.id === id)
    if (!session) return
    // Clear server-side cache for both possible keys
    await window.electronAPI.clearTitleCache(session.claudeSessionId ?? id)
    await window.electronAPI.clearTitleCache(id)
    // Clear client-side state and re-arm the generation effect
    clearAiTitle(id)
    titledSessionIds.current.delete(id)
    delete lastRegenerateRef.current[id]
  }, [sessions, clearAiTitle])

  return (
    <>
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
        filesOpen={showFiles}
        onToggleFiles={toggleFiles}
      />

      <div className="flex flex-1 overflow-hidden">
        {showSidebar && (
          <SessionSidebar
            sessions={sessions.filter(s => s.type === 'claude' || s.type === 'codex')}
            activeId={activeId}
            onSelect={setActive}
            onClose={handleCloseTab}
            onFork={handleForkTab}
            onRegenerateTitle={handleRegenerateTitle}
            onNewSession={openModal}
          />
        )}

        {showFiles && (() => {
          const id = activeFocusedId ?? activeId
          const cwd = sessions.find(s => s.id === id)?.cwd ?? null
          return (
            <FileBrowserPanel
              rootPath={cwd}
              onClose={() => setShowFiles(false)}
              onOpenFile={cwd ? (path) => { openFileInEditor(path, cwd) } : undefined}
            />
          )
        })()}

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
                onContextMenu={(e) => handlePaneContextMenu(e, session.id)}
              >
                {session.type === 'editor' && session.filePath ? (
                  <Editor
                    sessionId={session.id}
                    filePath={session.filePath}
                    isActive={isVisible && (isNonSplitActive || isFocused)}
                  />
                ) : (
                  <TerminalView
                    sessionId={session.id}
                    isActive={isVisible && (isNonSplitActive || isFocused)}
                    isShell={session.type === 'shell'}
                    onCmdK={() => setShowSwitcher(true)}
                    cwd={session.cwd}
                    onOpenPath={(filePath) => openFileInEditor(filePath, session.cwd)}
                  />
                )}
                {splitRect && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleClosePane(session.id) }}
                    title="Close pane"
                    className="absolute top-1 right-1 z-20 w-5 h-5 flex items-center justify-center text-sm leading-none rounded bg-black/40 text-[#aaa] hover:bg-black/70 hover:text-white"
                  >
                    ×
                  </button>
                )}
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
          onResumeCodex={handleResumeCodex}
          onNewInFolder={handleNewInFolder}
          onNewCodexInFolder={handleNewCodexInFolder}
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

      {showQuickOpen && (() => {
        const id = activeFocusedId ?? activeId
        const cwd = sessions.find(s => s.id === id)?.cwd ?? null
        return (
          <QuickOpenModal
            rootPath={cwd}
            onPick={(filePath) => { if (cwd) openFileInEditor(filePath, cwd) }}
            onClose={() => setShowQuickOpen(false)}
          />
        )
      })()}
    </div>
    <ToastStack />
    <ConfirmDialog />
    <ChoiceDialog />
    </>
  )
}
