import * as pty from 'node-pty'

type IPty = pty.IPty

const sessions = new Map<string, IPty>()

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
  if (forkSession) args.push('--fork-session')
  if (skipPermissions) args.push('--dangerously-skip-permissions')
  if (worktree) args.push('--worktree')
  let term: IPty
  try {
    term = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env } as Record<string, string>,
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
      env: { ...process.env } as Record<string, string>,
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
