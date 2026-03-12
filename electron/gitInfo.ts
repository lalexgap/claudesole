import { execFileSync } from 'child_process'
import path from 'path'

export interface GitInfo {
  branch: string | null
  isWorktree: boolean
}

export interface Worktree {
  path: string
  branch: string | null  // null if detached HEAD
  isMain: boolean
  repoRoot: string
}

export function listWorktrees(cwd: string): Worktree[] {
  try {
    const output = execFileSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    if (!output) return []

    const blocks = output.split(/\n\n+/)
    let repoRoot: string | null = null
    const result: Worktree[] = []

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i].trim()
      if (!block) continue

      const lines = block.split('\n')
      let worktreePath: string | null = null
      let branch: string | null = null

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          worktreePath = line.slice('worktree '.length).trim()
        } else if (line.startsWith('branch refs/heads/')) {
          branch = line.slice('branch refs/heads/'.length).trim()
        } else if (line === 'detached') {
          branch = null
        }
      }

      if (!worktreePath) continue

      const isMain = i === 0
      if (isMain) repoRoot = worktreePath

      result.push({
        path: worktreePath,
        branch,
        isMain,
        repoRoot: repoRoot ?? worktreePath,
      })
    }

    return result
  } catch {
    return []
  }
}

export function removeWorktree(repoPath: string, worktreePath: string, force: boolean): void {
  const args = ['-C', repoPath, 'worktree', 'remove']
  if (force) args.push('--force')
  args.push(worktreePath)
  execFileSync('git', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function listBranches(cwd: string): string[] {
  try {
    const output = execFileSync('git', ['-C', cwd, 'branch', '--format=%(refname:short)'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return output ? output.split('\n').map(b => b.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function getRepoRoot(cwd: string): string | null {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}

export function createWorktreeOnBranch(cwd: string, branch: string): string {
  const repoRoot = getRepoRoot(cwd)
  if (!repoRoot) throw new Error('Not a git repository')
  const repoName = path.basename(repoRoot)
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, '-')
  const worktreePath = path.join(path.dirname(repoRoot), `${repoName}-${safeBranch}`)
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', worktreePath, branch], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return worktreePath
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
