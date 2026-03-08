import { execFileSync } from 'child_process'

export interface GitInfo {
  branch: string | null
  isWorktree: boolean
}

export function getGitInfo(cwd: string): GitInfo | null {
  const run = (...args: string[]): string | null => {
    try {
      return execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      return null
    }
  }

  if (run('rev-parse', '--git-dir') === null) return null

  const branch = run('branch', '--show-current') || null
  const gitDir = run('rev-parse', '--git-dir')
  const commonDir = run('rev-parse', '--git-common-dir')

  // In a linked worktree, --git-dir points to .git/worktrees/<name>
  // while --git-common-dir points to the main .git — they differ
  const isWorktree = gitDir !== null && commonDir !== null && gitDir !== commonDir

  return { branch, isWorktree }
}
