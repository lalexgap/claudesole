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
  claudeSessionId?: string // the Claude-assigned session UUID (known for resumed sessions)
}

interface SessionsState {
  sessions: Session[]
  activeId: string | null
  addSession: (cwd: string, firstPrompt?: string, label?: string, claudeSessionId?: string) => string
  removeSession: (id: string) => void
  setActive: (id: string) => void
  markRunning: (id: string) => void
  markWaiting: (id: string) => void
  renameSession: (id: string, label: string) => void
  togglePin: (id: string) => void
}

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  activeId: null,

  addSession: (cwd: string, firstPrompt = '', label?: string, claudeSessionId?: string) => {
    const id = nanoid()
    const sessionLabel = label || cwd.split('/').pop() || cwd
    const session: Session = { id, cwd, label: sessionLabel, status: 'running', firstPrompt, pinned: false, claudeSessionId }
    set((state) => ({ sessions: [...state.sessions, session], activeId: id }))
    return id
  },

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
}))
