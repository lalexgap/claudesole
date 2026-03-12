import { app, BrowserWindow, ipcMain, dialog, session } from 'electron'
import path from 'path'
import fs from 'fs'
import { createSession, createShellSession, writeToSession, resizeSession, killSession } from './ptyManager'
import { listClaudeSessions, latestSessionIdForCwd, getUsageForCwd } from './sessionManager'
import { getGitInfo, listWorktrees, removeWorktree, listBranches, createWorktree } from './gitInfo'

function validateDir(p: unknown): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('Invalid path')
  const resolved = path.resolve(p)
  try {
    if (!fs.statSync(resolved).isDirectory()) throw new Error('Not a directory')
  } catch {
    throw new Error('Path does not exist or is not a directory')
  }
  return resolved
}

// Mutable reference updated each time a window is created, used by IPC handlers
// that need to communicate back to the renderer.
let win: BrowserWindow | null = null

function setupIpcHandlers() {
  ipcMain.handle('sessions:list', () => listClaudeSessions())

  ipcMain.handle('sessions:latestForCwd', (_event, cwd: string) => latestSessionIdForCwd(cwd))

  ipcMain.handle('sessions:getUsage', (_event, cwd: string) => getUsageForCwd(cwd))

  ipcMain.handle('git:info', (_event, cwd: string) => {
    try { return getGitInfo(validateDir(cwd)) } catch { return null }
  })

  ipcMain.handle('git:listWorktrees', (_event, cwd: string) => {
    try { return listWorktrees(validateDir(cwd)) } catch { return [] }
  })

  ipcMain.handle('git:listBranches', (_event, cwd: string) => {
    try { return listBranches(validateDir(cwd)) } catch { return [] }
  })

  ipcMain.handle('git:createWorktree', (_event, { repoPath, newBranch, baseBranch }: { repoPath: string; newBranch: string; baseBranch: string }) => {
    try {
      return createWorktree(validateDir(repoPath), newBranch, baseBranch)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to create worktree')
    }
  })

  ipcMain.handle('git:removeWorktree', (_event, { repoPath, worktreePath, force }: { repoPath: string; worktreePath: string; force: boolean }) => {
    try {
      removeWorktree(validateDir(repoPath), validateDir(worktreePath), force)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to remove worktree')
    }
  })

  ipcMain.on('pty:create', (_event, { sessionId, cwd, resumeSessionId, skipPermissions, worktree, forkSession }: { sessionId: string; cwd: string; resumeSessionId?: string; skipPermissions?: boolean; worktree?: boolean | string; forkSession?: boolean }) => {
    let validCwd: string
    try { validCwd = validateDir(cwd) } catch { win?.webContents.send('pty:exit', { sessionId }); return }
    createSession(sessionId, validCwd, resumeSessionId ?? null, skipPermissions ?? true, worktree ?? false, forkSession ?? false, (data) => {
      win?.webContents.send('pty:data', { sessionId, data })
    }, () => {
      win?.webContents.send('pty:exit', { sessionId })
    })
  })

  ipcMain.on('pty:createShell', (_event, { sessionId, cwd }: { sessionId: string; cwd: string }) => {
    let validCwd: string
    try { validCwd = validateDir(cwd) } catch { win?.webContents.send('pty:exit', { sessionId }); return }
    createShellSession(sessionId, validCwd, (data) => {
      win?.webContents.send('pty:data', { sessionId, data })
    }, () => {
      win?.webContents.send('pty:exit', { sessionId })
    })
  })

  ipcMain.on('pty:write', (_event, { sessionId, data }: { sessionId: string; data: string }) => {
    writeToSession(sessionId, data)
  })

  ipcMain.on('pty:resize', (_event, { sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) => {
    resizeSession(sessionId, cols, rows)
  })

  ipcMain.on('pty:kill', (_event, { sessionId }: { sessionId: string }) => {
    killSession(sessionId)
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.on('app:setBadgeCount', (_event, count: number) => {
    app.setBadgeCount(count)
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  // Keyboard shortcut Cmd+T for new session (sent to renderer)
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.meta && input.key === 't' && input.type === 'keyDown') {
      win?.webContents.send('shortcut:newSession')
    }
  })
}

app.whenReady().then(() => {
  // Auto-approve notification permission requests from the renderer
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'notifications')
  })
  setupIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
