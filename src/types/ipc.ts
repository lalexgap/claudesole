export interface Worktree {
  path: string
  branch: string | null
  isMain: boolean
  repoRoot: string
}

export interface ClaudeSession {
  sessionId: string
  cwd: string
  projectName: string
  slug: string
  lastActivity: number // mtime ms
  firstPrompt: string
  latestPrompt: string
  tokensUsed?: number
  model?: string
}

export interface ElectronAPI {
  createSession: (sessionId: string, cwd: string, resumeSessionId?: string, skipPermissions?: boolean, worktree?: boolean, forkSession?: boolean) => void
  createShellSession: (sessionId: string, cwd: string) => void
  latestSessionForCwd: (cwd: string) => Promise<string | null>
  writeSession: (sessionId: string, data: string) => void
  resizeSession: (sessionId: string, cols: number, rows: number) => void
  killSession: (sessionId: string) => void
  openDirectory: () => Promise<string | null>
  listSessions: () => Promise<ClaudeSession[]>
  onData: (callback: (sessionId: string, data: string) => void) => () => void
  onExit: (callback: (sessionId: string) => void) => () => void
  onShortcutNewSession: (callback: () => void) => () => void
  setBadgeCount: (count: number) => void
  getSessionUsage: (cwd: string) => Promise<{ tokensUsed?: number; model?: string } | null>
  getGitInfo: (cwd: string) => Promise<{ branch: string | null; isWorktree: boolean } | null>
  listWorktrees: (cwd: string) => Promise<Worktree[]>
  removeWorktree: (repoPath: string, worktreePath: string, force: boolean) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
