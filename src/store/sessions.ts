import { create } from 'zustand'
import { nanoid } from 'nanoid'

export type SessionStatus = 'running' | 'waiting'

export interface Session {
  id: string
  cwd: string
  label: string
  status: SessionStatus
  firstPrompt: string
  pinned: boolean
  type: 'claude' | 'codex' | 'shell' | 'editor'
  claudeSessionId?: string // the Claude-assigned session UUID (known for resumed sessions)
  codexSessionId?: string // the Codex-assigned session UUID (known for resumed sessions)
  isWorktree?: boolean
  aiTitle?: string
  branch?: string | null
  userHasTyped?: boolean  // true once the user has sent input in this tab session
  // Editor-only fields. `filePath` is the absolute path on disk; `isDirty` flips
  // true on edit and back to false on save. Editor sessions are not backed by a PTY.
  filePath?: string
  isDirty?: boolean
}

interface SessionsState {
  sessions: Session[]
  activeId: string | null
  addSession: (cwd: string, firstPrompt?: string, label?: string, claudeSessionId?: string, type?: 'claude' | 'codex' | 'shell', isWorktree?: boolean, codexSessionId?: string) => string
  addEditorSession: (filePath: string, cwd: string) => string
  setDirty: (id: string, isDirty: boolean) => void
  removeSession: (id: string) => void
  setActive: (id: string) => void
  markRunning: (id: string) => void
  markWaiting: (id: string) => void
  renameSession: (id: string, label: string) => void
  togglePin: (id: string) => void
  reorderSession: (id: string, toIndex: number) => void
  setAiTitle: (id: string, title: string) => void
  clearAiTitle: (id: string) => void
  setBranch: (id: string, branch: string | null) => void
  setUserHasTyped: (id: string) => void
  setFirstPrompt: (id: string, prompt: string) => void
  hydrateEditorTabs: (tabs: Session[], activeId: string | null) => void
}

const STORAGE_KEY = 'claudesole.editor-sessions.v1'

interface PersistedEditor {
  id: string
  cwd: string
  label: string
  filePath: string
  pinned: boolean
}
interface PersistedState {
  tabs: PersistedEditor[]
  activeId: string | null
}

function loadPersisted(): PersistedState {
  if (typeof localStorage === 'undefined') return { tabs: [], activeId: null }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { tabs: [], activeId: null }
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.tabs)) return { tabs: [], activeId: null }
    return parsed as PersistedState
  } catch {
    return { tabs: [], activeId: null }
  }
}

function savePersisted(sessions: Session[], activeId: string | null) {
  if (typeof localStorage === 'undefined') return
  const tabs: PersistedEditor[] = sessions
    .filter(s => s.type === 'editor' && !!s.filePath)
    .map(s => ({ id: s.id, cwd: s.cwd, label: s.label, filePath: s.filePath!, pinned: s.pinned }))
  // Persist activeId only if it points at an editor we're persisting; otherwise
  // null so terminal-tab focus doesn't leak across reloads.
  const persistedActiveId = tabs.some(t => t.id === activeId) ? activeId : null
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId: persistedActiveId }))
  } catch {}
}

export function hydrateEditorSessions(): { sessions: Session[]; activeId: string | null } {
  const { tabs, activeId } = loadPersisted()
  const sessions: Session[] = tabs.map(t => ({
    id: t.id, cwd: t.cwd, label: t.label, status: 'waiting' as SessionStatus,
    firstPrompt: '', pinned: t.pinned, type: 'editor', filePath: t.filePath, isDirty: false,
  }))
  return { sessions, activeId }
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  activeId: null,

  addSession: (cwd: string, firstPrompt = '', label?: string, claudeSessionId?: string, type: 'claude' | 'codex' | 'shell' = 'claude', isWorktree?: boolean, codexSessionId?: string) => {
    const id = nanoid()
    const sessionLabel = label || cwd.split('/').pop() || cwd
    const session: Session = { id, cwd, label: sessionLabel, status: 'running', firstPrompt, pinned: false, type, claudeSessionId, codexSessionId, isWorktree }
    set((state) => ({ sessions: [...state.sessions, session], activeId: id }))
    return id
  },

  addEditorSession: (filePath: string, cwd: string) => {
    const id = nanoid()
    const label = filePath.split('/').pop() || filePath
    const session: Session = {
      id, cwd, label, status: 'waiting', firstPrompt: '', pinned: false,
      type: 'editor', filePath, isDirty: false,
    }
    set((state) => ({ sessions: [...state.sessions, session], activeId: id }))
    return id
  },

  setDirty: (id: string, isDirty: boolean) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id && s.isDirty !== isDirty ? { ...s, isDirty } : s),
    })),

  removeSession: (id: string) => {
    set((state) => {
      const idx = state.sessions.findIndex((s) => s.id === id)
      const remaining = state.sessions.filter((s) => s.id !== id)
      let nextActive = state.activeId
      if (state.activeId === id) {
        nextActive = remaining.length > 0 ? remaining[Math.min(idx, remaining.length - 1)].id : null
      }
      return { sessions: remaining, activeId: nextActive }
    })
  },

  setActive: (id: string) => set({ activeId: id }),

  markRunning: (id: string) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id ? { ...s, status: 'running' as SessionStatus } : s),
    })),

  markWaiting: (id: string) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id ? { ...s, status: 'waiting' as SessionStatus } : s),
    })),

  renameSession: (id: string, label: string) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id ? { ...s, label } : s),
    })),

  togglePin: (id: string) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id ? { ...s, pinned: !s.pinned } : s),
    })),

  // `toIndex` is the insert-before position in the original array (drag-and-drop semantics).
  // Moving [a,b,c] with reorder(a, 2) yields [b, a, c]; pass length (3) to move to the end.
  reorderSession: (id: string, toIndex: number) =>
    set((state) => {
      const from = state.sessions.findIndex((s) => s.id === id)
      if (from === -1 || from === toIndex) return state
      const arr = [...state.sessions]
      const [item] = arr.splice(from, 1)
      arr.splice(toIndex > from ? toIndex - 1 : toIndex, 0, item)
      return { sessions: arr }
    }),

  setAiTitle: (id: string, title: string) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id ? { ...s, aiTitle: title } : s),
    })),

  clearAiTitle: (id: string) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id ? { ...s, aiTitle: undefined } : s),
    })),

  setBranch: (id: string, branch: string | null) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id ? { ...s, branch } : s),
    })),

  setUserHasTyped: (id: string) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id && !s.userHasTyped ? { ...s, userHasTyped: true } : s),
    })),

  setFirstPrompt: (id: string, prompt: string) =>
    set((state) => ({
      sessions: state.sessions.map((s) => s.id === id && !s.firstPrompt ? { ...s, firstPrompt: prompt } : s),
    })),

  hydrateEditorTabs: (tabs: Session[], activeId: string | null) =>
    set((state) => {
      // Only inject editors that aren't already present (by file path) — avoids
      // duplicates if hydrate runs more than once for any reason.
      const existing = new Set(state.sessions.filter(s => s.type === 'editor').map(s => s.filePath))
      const toAdd = tabs.filter(t => t.filePath && !existing.has(t.filePath))
      const sessions = [...state.sessions, ...toAdd]
      const nextActive = activeId && sessions.some(s => s.id === activeId) ? activeId : state.activeId
      return { sessions, activeId: nextActive }
    }),
}))

// Persist editor sessions whenever the store changes. Terminal sessions are
// not persisted — their PTYs are ephemeral, restoring tab metadata without
// the underlying process would surface broken tabs.
//
// The flag guards against the early-mount race: if the user creates a
// terminal tab before persisted editors have been hydrated, subscribe
// would otherwise save `{ tabs: [] }` and wipe localStorage.
let persistenceArmed = false
export function armEditorPersistence(): void { persistenceArmed = true }

useSessionsStore.subscribe((state) => {
  if (!persistenceArmed) return
  savePersisted(state.sessions, state.activeId)
})
