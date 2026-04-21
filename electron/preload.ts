import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  createSession: (sessionId: string, cwd: string, resumeSessionId?: string, skipPermissions?: boolean, worktree?: boolean | string, forkSession?: boolean) =>
    ipcRenderer.send('pty:create', { sessionId, cwd, resumeSessionId, skipPermissions, worktree, forkSession }),

  createCodexSession: (sessionId: string, cwd: string, resumeSessionId?: string, skipPermissions?: boolean, forkSession?: boolean) =>
    ipcRenderer.send('pty:createCodex', { sessionId, cwd, resumeSessionId, skipPermissions, forkSession }),

  createShellSession: (sessionId: string, cwd: string) =>
    ipcRenderer.send('pty:createShell', { sessionId, cwd }),

  latestSessionForCwd: (cwd: string): Promise<string | null> =>
    ipcRenderer.invoke('sessions:latestForCwd', cwd),

  writeSession: (sessionId: string, data: string) =>
    ipcRenderer.send('pty:write', { sessionId, data }),

  resizeSession: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', { sessionId, cols, rows }),

  killSession: (sessionId: string) =>
    ipcRenderer.send('pty:kill', { sessionId }),

  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openDirectory'),

  listSessions: () => ipcRenderer.invoke('sessions:list'),
  listCodexSessions: () => ipcRenderer.invoke('sessions:listCodex'),

  onData: (callback: (sessionId: string, data: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, { sessionId, data }: { sessionId: string; data: string }) =>
      callback(sessionId, data)
    ipcRenderer.on('pty:data', handler)
    return () => ipcRenderer.removeListener('pty:data', handler)
  },

  onExit: (callback: (sessionId: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, { sessionId }: { sessionId: string }) =>
      callback(sessionId)
    ipcRenderer.on('pty:exit', handler)
    return () => ipcRenderer.removeListener('pty:exit', handler)
  },

  onShortcutNewSession: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('shortcut:newSession', handler)
    return () => ipcRenderer.removeListener('shortcut:newSession', handler)
  },

  setBadgeCount: (count: number) =>
    ipcRenderer.send('app:setBadgeCount', count),

  getSessionUsage: (cwd: string): Promise<{ tokensUsed?: number; model?: string } | null> =>
    ipcRenderer.invoke('sessions:getUsage', cwd),

  getGitInfo: (cwd: string): Promise<{ branch: string | null; isWorktree: boolean } | null> =>
    ipcRenderer.invoke('git:info', cwd),

  listWorktrees: (cwd: string): Promise<import('./gitInfo').Worktree[]> =>
    ipcRenderer.invoke('git:listWorktrees', cwd),

  removeWorktree: (repoPath: string, worktreePath: string, force: boolean): Promise<void> =>
    ipcRenderer.invoke('git:removeWorktree', { repoPath, worktreePath, force }),

  listBranches: (cwd: string): Promise<string[]> =>
    ipcRenderer.invoke('git:listBranches', cwd),

  createWorktree: (repoPath: string, branch: string, baseBranch?: string): Promise<string> =>
    ipcRenderer.invoke('git:createWorktree', { repoPath, branch, baseBranch }),

  openExternal: (url: string) =>
    ipcRenderer.send('shell:openExternal', url),

  getLatestSession: (cwd: string) =>
    ipcRenderer.invoke('sessions:latestSession', cwd),

  getSessionById: (sessionId: string) =>
    ipcRenderer.invoke('sessions:byId', sessionId),

  generateSessionTitle: (sessionId: string, firstPrompt: string, latestPrompt?: string): Promise<string | null> =>
    ipcRenderer.invoke('title:generate', { sessionId, firstPrompt, latestPrompt }),

  clearTitleCache: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('title:clearCache', sessionId),

  clearAllTitleCache: (): Promise<void> =>
    ipcRenderer.invoke('title:clearAllCache'),

  generateSessionSummary: (sessionId: string, firstPrompt: string, latestPrompt?: string): Promise<string | null> =>
    ipcRenderer.invoke('summary:generate', { sessionId, firstPrompt, latestPrompt }),

  getLogs: (): Promise<{ level: string; msg: string; ts: number }[]> =>
    ipcRenderer.invoke('logs:get'),

  onLog: (callback: (entry: { level: string; msg: string; ts: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, entry: { level: string; msg: string; ts: number }) => callback(entry)
    ipcRenderer.on('logs:entry', handler)
    return () => ipcRenderer.removeListener('logs:entry', handler)
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),

  saveSettings: (s: unknown) => ipcRenderer.invoke('settings:save', s),

  embeddingsAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('embeddings:available'),

  ensureEmbeddings: (sessions: unknown[]): Promise<{ total: number; indexed: number }> =>
    ipcRenderer.invoke('embeddings:ensure', sessions),

  semanticSearch: (query: string, sessions: unknown[], topK?: number): Promise<Array<{ session: unknown; score: number }>> =>
    ipcRenderer.invoke('embeddings:search', { query, sessions, topK }),

  fullTextSearchSessions: (query: string, limit?: number): Promise<Array<{ source: 'claude' | 'codex'; sessionId: string; snippet: string }>> =>
    ipcRenderer.invoke('search:fullText', { query, limit }),

  listDirectory: (dirPath: string): Promise<Array<{ name: string; path: string; isDir: boolean; isHidden: boolean }>> =>
    ipcRenderer.invoke('fs:listDir', dirPath),

  walkDirectory: (rootPath: string, includeHidden?: boolean, maxEntries?: number): Promise<{ entries: Array<{ name: string; path: string; relPath: string }>; truncated: boolean; cap: number }> =>
    ipcRenderer.invoke('fs:walkDir', { rootPath, includeHidden, maxEntries }),

})
