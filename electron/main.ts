import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { createSession, createShellSession, writeToSession, resizeSession, killSession } from './ptyManager'
import { listClaudeSessions, latestSessionIdForCwd, getUsageForCwd } from './sessionManager'

function createWindow() {
  const win = new BrowserWindow({
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

  // PTY IPC handlers
  ipcMain.handle('sessions:list', () => listClaudeSessions())

  ipcMain.handle('sessions:latestForCwd', (_event, cwd: string) => latestSessionIdForCwd(cwd))

  ipcMain.handle('sessions:getUsage', (_event, cwd: string) => getUsageForCwd(cwd))

  ipcMain.on('pty:create', (_event, { sessionId, cwd, resumeSessionId, skipPermissions, worktree, forkSession }: { sessionId: string; cwd: string; resumeSessionId?: string; skipPermissions?: boolean; worktree?: boolean; forkSession?: boolean }) => {
    createSession(sessionId, cwd, resumeSessionId ?? null, skipPermissions ?? true, worktree ?? false, forkSession ?? false, (data) => {
      win.webContents.send('pty:data', { sessionId, data })
    }, () => {
      win.webContents.send('pty:exit', { sessionId })
    })
  })

  ipcMain.on('pty:createShell', (_event, { sessionId, cwd }: { sessionId: string; cwd: string }) => {
    createShellSession(sessionId, cwd, (data) => {
      win.webContents.send('pty:data', { sessionId, data })
    }, () => {
      win.webContents.send('pty:exit', { sessionId })
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
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.on('app:setBadgeCount', (_event, count: number) => {
    app.setBadgeCount(count)
  })

  // Keyboard shortcut Cmd+T for new session (sent to renderer)
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.meta && input.key === 't' && input.type === 'keyDown') {
      win.webContents.send('shortcut:newSession')
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
