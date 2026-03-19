import { execFileSync } from 'child_process'
import fs from 'fs'
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

export function createWorktree(repoPath: string, branch: string): string {
  const dirName = branch.replace(/\//g, '-')
  const worktreePath = path.join(repoPath, '.claude', 'worktrees', dirName)
  execFileSync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, branch], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return worktreePath
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


// Resolves a valid cwd for a session whose original worktree directory may be missing.
// 1. If the path exists, returns it as-is.
// 2. If not, walks up to find the git repo root.
// 3. Checks if git still has a registered (but directory-missing) worktree for that path —
//    which happens when the directory was deleted without `git worktree remove`. In that case,
//    recreates the worktree directory so the session can resume there.
// 4. Falls back to the repo root if the worktree was properly removed (no git record).
// Returns null if no git repo is found anywhere in the ancestor chain.
export function resolveWorktreeCwd(missingPath: string): string | null {
  // Find nearest ancestor that exists and belongs to a git repo
  let repoRoot: string | null = null
  let dir = path.dirname(missingPath)
  const fsRoot = path.parse(dir).root
  while (dir && dir !== fsRoot) {
    try {
      const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim()
      if (top) { repoRoot = top; break }
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  if (!repoRoot) return null

  // Check if git still knows about this worktree (directory manually deleted, not `git worktree remove`'d)
  const worktrees = listWorktrees(repoRoot)
  const registered = worktrees.find(w => w.path === missingPath && w.branch)
  if (registered?.branch) {
    try {
      execFileSync('git', ['-C', repoRoot, 'worktree', 'add', missingPath, registered.branch], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
      })
      return missingPath
    } catch {}
  }

  // Worktree was properly removed — recreate the directory so Claude can find the session via
  // --resume <uuid>. Claude looks up sessions by encoded cwd path, so it must run from the
  // original path even if it's no longer a git worktree.
  try {
    fs.mkdirSync(missingPath, { recursive: true })
    return missingPath
  } catch {}

  return repoRoot
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
