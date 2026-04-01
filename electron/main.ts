import { app, BrowserWindow, ipcMain, dialog, session, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { createSession, createShellSession, writeToSession, resizeSession, killSession } from './ptyManager'
import { listClaudeSessions, latestSessionIdForCwd, latestSessionForCwd, getUsageForCwd, buildSummaryContext, invalidateSessionsCache } from './sessionManager'
import { getGitInfo, listWorktrees, removeWorktree, listBranches, createWorktree, resolveWorktreeCwd } from './gitInfo'
import { generateTitle, generateSummary, clearTitleCache, clearAllTitleCache } from './titleManager'
import { ensureEmbeddings, semanticSearch, getIndexedCount, isEmbeddingAvailable } from './embeddingManager'
import { getSettings, saveSettings } from './settingsManager'

// ── Log capture ──────────────────────────────────────────────────────────────
interface LogEntry { level: 'log' | 'warn' | 'error'; msg: string; ts: number }
const logBuffer: LogEntry[] = []
const MAX_LOG_ENTRIES = 500

function pushLog(level: LogEntry['level'], ...args: unknown[]) {
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  const entry: LogEntry = { level, msg, ts: Date.now() }
  logBuffer.push(entry)
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift()
  win?.webContents.send('logs:entry', entry)
}

const _log = console.log.bind(console)
const _warn = console.warn.bind(console)
const _error = console.error.bind(console)
console.log = (...a) => { _log(...a); pushLog('log', ...a) }
console.warn = (...a) => { _warn(...a); pushLog('warn', ...a) }
console.error = (...a) => { _error(...a); pushLog('error', ...a) }

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

function isSafeUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Mutable reference updated each time a window is created, used by IPC handlers
// that need to communicate back to the renderer.
let win: BrowserWindow | null = null

function setupIpcHandlers() {
  ipcMain.handle('sessions:list', () => listClaudeSessions())

  ipcMain.handle('sessions:latestForCwd', (_event, cwd: string) => latestSessionIdForCwd(cwd))
  ipcMain.handle('sessions:latestSession', (_event, cwd: string) => {
    // Force fresh disk read — stale cache could return the previous session's JSONL
    // before the new session's file has been written, causing the old title to be reused.
    invalidateSessionsCache()
    return latestSessionForCwd(cwd)
  })

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

  ipcMain.handle('git:createWorktree', (_event, { repoPath, branch }: { repoPath: string; branch: string }) => {
    try {
      return createWorktree(validateDir(repoPath), branch)
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
    try {
      validCwd = validateDir(cwd)
    } catch {
      // cwd may be a deleted worktree — try to recreate it, or fall back to repo root
      const resolved = resolveWorktreeCwd(cwd)
      try {
        if (!resolved) throw new Error('no repo root')
        validCwd = validateDir(resolved)
      } catch {
        win?.webContents.send('pty:exit', { sessionId })
        return
      }
    }
    console.log(`[pty:create] sessionId=${sessionId} cwd=${validCwd} resume=${resumeSessionId ?? 'none'}`)
    createSession(sessionId, validCwd, resumeSessionId ?? null, skipPermissions ?? true, worktree ?? false, forkSession ?? false, (data) => {
      win?.webContents.send('pty:data', { sessionId, data })
    }, () => {
      console.log(`[pty:exit] sessionId=${sessionId}`)
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

  ipcMain.on('shell:openExternal', (_event, url: string) => {
    if (isSafeUrl(url)) {
      shell.openExternal(url)
    }
  })

  ipcMain.handle('title:generate', (_e, { sessionId, firstPrompt, latestPrompt }: { sessionId: string; firstPrompt: string; latestPrompt?: string }) =>
    generateTitle(sessionId, firstPrompt, latestPrompt))

  ipcMain.handle('title:clearCache', (_e, sessionId: string) => {
    clearTitleCache(sessionId)
  })

  ipcMain.handle('title:clearAllCache', () => {
    clearAllTitleCache()
  })

  ipcMain.handle('summary:generate', (_e, { sessionId, firstPrompt }: { sessionId: string; firstPrompt: string; latestPrompt?: string }) => {
    const context = buildSummaryContext(sessionId) ?? firstPrompt
    return generateSummary(sessionId, context)
  })

  ipcMain.handle('embeddings:available', () => isEmbeddingAvailable())

  ipcMain.handle('embeddings:ensure', (_e, sessions) => {
    ensureEmbeddings(sessions).catch(err => console.error('[main] embeddings:ensure:', err))
    return { total: sessions.length, indexed: getIndexedCount() }
  })

  ipcMain.handle('embeddings:search', (_e, { query, sessions, topK }) =>
    semanticSearch(query, sessions, topK ?? 20)
  )

  ipcMain.handle('logs:get', () => [...logBuffer])

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:save', (_e, s) => { saveSettings(s); return true })
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

  // Prevent external URLs from opening inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
      if (isSafeUrl(url)) shell.openExternal(url)
    }
  })

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
