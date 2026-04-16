export interface AppSettings {
  titleProvider: 'anthropic' | 'openai-compatible' | 'none'
  apiKey: string
  model: string
  baseUrl: string
}

export interface Worktree {
  path: string
  branch: string | null
  isMain: boolean
  repoRoot: string
}

export interface CodexSession {
  sessionId: string
  cwd: string
  projectName: string
  slug: string
  lastActivity: number
  firstPrompt: string
  latestPrompt: string
  model?: string
  title?: string
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
  title?: string
  summary?: string
}

export interface ElectronAPI {
  createSession: (sessionId: string, cwd: string, resumeSessionId?: string, skipPermissions?: boolean, worktree?: boolean | string, forkSession?: boolean) => void
  createCodexSession: (sessionId: string, cwd: string, resumeSessionId?: string, skipPermissions?: boolean, forkSession?: boolean) => void
  createShellSession: (sessionId: string, cwd: string) => void
  latestSessionForCwd: (cwd: string) => Promise<string | null>
  writeSession: (sessionId: string, data: string) => void
  resizeSession: (sessionId: string, cols: number, rows: number) => void
  killSession: (sessionId: string) => void
  openDirectory: () => Promise<string | null>
  listSessions: () => Promise<ClaudeSession[]>
  listCodexSessions: () => Promise<CodexSession[]>
  onData: (callback: (sessionId: string, data: string) => void) => () => void
  onExit: (callback: (sessionId: string) => void) => () => void
  onShortcutNewSession: (callback: () => void) => () => void
  setBadgeCount: (count: number) => void
  getSessionUsage: (cwd: string) => Promise<{ tokensUsed?: number; model?: string } | null>
  getGitInfo: (cwd: string) => Promise<{ branch: string | null; isWorktree: boolean } | null>
  listWorktrees: (cwd: string) => Promise<Worktree[]>
  removeWorktree: (repoPath: string, worktreePath: string, force: boolean) => Promise<void>
  listBranches: (cwd: string) => Promise<string[]>
  createWorktree: (repoPath: string, branch: string) => Promise<string>
  openExternal: (url: string) => void
  getLatestSession: (cwd: string) => Promise<ClaudeSession | null>
  getSessionById: (sessionId: string) => Promise<ClaudeSession | null>
  generateSessionTitle: (sessionId: string, firstPrompt: string, latestPrompt?: string) => Promise<string | null>
  generateSessionSummary: (sessionId: string, firstPrompt: string, latestPrompt?: string) => Promise<string | null>
  clearTitleCache: (sessionId: string) => Promise<void>
  clearAllTitleCache: () => Promise<void>
  getLogs: () => Promise<{ level: string; msg: string; ts: number }[]>
  onLog: (callback: (entry: { level: string; msg: string; ts: number }) => void) => () => void
  getSettings: () => Promise<AppSettings>
  saveSettings: (s: AppSettings) => Promise<boolean>
  embeddingsAvailable: () => Promise<boolean>
  ensureEmbeddings: (sessions: ClaudeSession[]) => Promise<{ total: number; indexed: number }>
  semanticSearch: (query: string, sessions: ClaudeSession[], topK?: number) => Promise<Array<{ session: ClaudeSession; score: number }>>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
