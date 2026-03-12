import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  createSession: (sessionId: string, cwd: string, resumeSessionId?: string, skipPermissions?: boolean, worktree?: boolean | string, forkSession?: boolean) =>
    ipcRenderer.send('pty:create', { sessionId, cwd, resumeSessionId, skipPermissions, worktree, forkSession }),

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

  createWorktree: (repoPath: string, branch: string): Promise<string> =>
    ipcRenderer.invoke('git:createWorktree', { repoPath, branch }),

})
