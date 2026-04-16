import * as pty from 'node-pty'
import { execFileSync } from 'child_process'
import fs from 'fs'

type IPty = pty.IPty

const sessions = new Map<string, IPty>()

// In packaged apps macOS launches with a minimal PATH that won't include
// user-installed tools (npm globals, homebrew, etc). Resolve the full PATH
// from a login shell once and reuse it for all spawned processes.
let resolvedEnv: Record<string, string> | null = null

export function getEnv(): Record<string, string> {
  if (resolvedEnv) return resolvedEnv
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const output = execFileSync(shell, ['-i', '-l', '-c', 'env -0'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    const env: Record<string, string> = { ...process.env } as Record<string, string>
    for (const entry of output.split('\0')) {
      const eq = entry.indexOf('=')
      if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
    }
    resolvedEnv = env
  } catch {
    resolvedEnv = { ...process.env } as Record<string, string>
  }
  return resolvedEnv
}

export function createSession(
  sessionId: string,
  cwd: string,
  resumeSessionId: string | null,
  skipPermissions: boolean,
  worktree: boolean | string,
  forkSession: boolean,
  onData: (data: string) => void,
  onExit: () => void
) {
  const args: string[] = []
  if (resumeSessionId) args.push('--resume', resumeSessionId)
  if (forkSession && resumeSessionId) args.push('--fork-session')
  if (skipPermissions) args.push('--dangerously-skip-permissions')
  if (worktree) { args.push('--worktree'); if (typeof worktree === 'string') args.push(worktree) }
  let term: IPty
  try {
    term = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: getEnv(),
    })
  } catch (err) {
    console.error('[ptyManager] spawn failed:', err)
    onExit()
    return
  }

  term.onData(onData)
  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] session ${sessionId} exited: code=${exitCode} signal=${signal}`)
    sessions.delete(sessionId)
    onExit()
  })
  sessions.set(sessionId, term)
}

export function writeToSession(sessionId: string, data: string) {
  sessions.get(sessionId)?.write(data)
}

export function resizeSession(sessionId: string, cols: number, rows: number) {
  if (cols > 0 && rows > 0) {
    try { sessions.get(sessionId)?.resize(cols, rows) } catch {}
  }
}

export function createShellSession(
  sessionId: string,
  cwd: string,
  onData: (data: string) => void,
  onExit: () => void
) {
  const shell = process.env.SHELL || '/bin/zsh'
  let term: IPty
  try {
    term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: getEnv(),
    })
  } catch (err) {
    console.error('[ptyManager] shell spawn failed:', err)
    onExit()
    return
  }
  term.onData(onData)
  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] shell session ${sessionId} exited: code=${exitCode} signal=${signal}`)
    sessions.delete(sessionId)
    onExit()
  })
  sessions.set(sessionId, term)
}

// Codex ships as a native binary inside the macOS app bundle. When invoked via
// the npm wrapper, it may fail if the optional native package is not installed.
// Check known locations in priority order before falling back to PATH lookup.
function resolveCodexBinary(): string {
  const candidates = [
    '/Applications/Codex.app/Contents/Resources/codex',
  ]
  for (const p of candidates) {
    try { if (fs.statSync(p).isFile()) return p } catch {}
  }
  return 'codex'
}

export function createCodexSession(
  sessionId: string,
  cwd: string,
  resumeSessionId: string | null,
  skipPermissions: boolean,
  forkSession: boolean,
  onData: (data: string) => void,
  onExit: () => void
) {
  const skipFlag = '--dangerously-bypass-approvals-and-sandbox'
  let args: string[]
  if (forkSession && resumeSessionId) {
    args = ['fork', resumeSessionId, ...(skipPermissions ? [skipFlag] : [])]
  } else if (resumeSessionId) {
    args = ['resume', resumeSessionId, ...(skipPermissions ? [skipFlag] : [])]
  } else {
    args = skipPermissions ? [skipFlag] : []
  }
  const codexBin = resolveCodexBinary()
  let term: IPty
  try {
    term = pty.spawn(codexBin, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: getEnv(),
    })
  } catch (err) {
    console.error('[ptyManager] codex spawn failed:', err)
    onExit()
    return
  }
  term.onData(onData)
  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] codex session ${sessionId} exited: code=${exitCode} signal=${signal}`)
    sessions.delete(sessionId)
    onExit()
  })
  sessions.set(sessionId, term)
}

export function killSession(sessionId: string) {
  const term = sessions.get(sessionId)
  if (term) {
    try { term.kill() } catch {}
    sessions.delete(sessionId)
  }
}
