import * as pty from 'node-pty'
import { execFileSync } from 'child_process'

type IPty = pty.IPty

const sessions = new Map<string, IPty>()

// In packaged apps macOS launches with a minimal PATH that won't include
// user-installed tools (npm globals, homebrew, etc). Resolve the full PATH
// from a login shell once and reuse it for all spawned processes.
let resolvedEnv: Record<string, string> | null = null

function getEnv(): Record<string, string> {
  if (resolvedEnv) return resolvedEnv
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const output = execFileSync(shell, ['-l', '-c', 'env -0'], {
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
  worktree: boolean,
  forkSession: boolean,
  onData: (data: string) => void,
  onExit: () => void
) {
  const args: string[] = []
  if (resumeSessionId) args.push('--resume', resumeSessionId)
  if (forkSession && resumeSessionId) args.push('--fork-session')
  if (skipPermissions) args.push('--dangerously-skip-permissions')
  if (worktree) args.push('--worktree')
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
  term.onExit(() => {
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
  term.onExit(() => {
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
