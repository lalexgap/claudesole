import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildCreateWorktreeArgs,
  createWorktree,
  listWorktrees,
  listBranches,
  resolveWorktreeCwd,
  getGitInfo,
} from './gitInfo'

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const gitAvailable = hasGit()

function makeRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-git-'))
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', repo, 'config', 'commit.gpgsign', 'false'])
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n')
  execFileSync('git', ['-C', repo, 'add', '.'])
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
  return repo
}

describe('buildCreateWorktreeArgs', () => {
  it('branch-only mode builds "worktree add <path> <branch>"', () => {
    const { args, worktreePath } = buildCreateWorktreeArgs('/repo', 'feature-x')
    expect(args).toEqual(['-C', '/repo', 'worktree', 'add', worktreePath, 'feature-x'])
    expect(worktreePath).toBe(path.join('/repo', '.claude', 'worktrees', 'feature-x'))
  })

  it('with baseBranch builds "worktree add -b <branch> <path> <base>"', () => {
    const { args, worktreePath } = buildCreateWorktreeArgs('/repo', 'feature-x', 'main')
    expect(args).toEqual(['-C', '/repo', 'worktree', 'add', '-b', 'feature-x', worktreePath, 'main'])
  })

  it('sanitizes slashes in branch name for the worktree directory', () => {
    const { worktreePath, args } = buildCreateWorktreeArgs('/repo', 'feature/foo/bar', 'main')
    expect(worktreePath.endsWith(path.join('.claude', 'worktrees', 'feature-foo-bar'))).toBe(true)
    expect(args).toContain('feature/foo/bar')
  })
})

describe.skipIf(!gitAvailable)('listWorktrees', () => {
  let repo: string
  const cleanup: string[] = []

  beforeEach(() => {
    repo = makeRepo()
    cleanup.push(repo)
  })

  afterEach(() => {
    for (const dir of cleanup.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  })

  it('returns the main worktree for a fresh repo', () => {
    const wts = listWorktrees(repo)
    expect(wts.length).toBeGreaterThanOrEqual(1)
    expect(wts[0].isMain).toBe(true)
    expect(wts[0].branch).toBe('main')
    expect(fs.realpathSync(wts[0].path)).toBe(fs.realpathSync(repo))
  })

  it('lists main + linked worktree after createWorktree with baseBranch', () => {
    createWorktree(repo, 'feature-a', 'main')
    const wts = listWorktrees(repo)
    expect(wts.length).toBe(2)
    expect(wts.find(w => w.branch === 'feature-a')).toBeTruthy()
    expect(wts.find(w => w.isMain)?.branch).toBe('main')
  })

  it('returns [] for a non-git path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-nogit-'))
    cleanup.push(tmp)
    expect(listWorktrees(tmp)).toEqual([])
  })
})

describe.skipIf(!gitAvailable)('listBranches', () => {
  it('returns the default branch after init', () => {
    const repo = makeRepo()
    try {
      expect(listBranches(repo)).toEqual(['main'])
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns [] for a non-git path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-nogit-'))
    try {
      expect(listBranches(tmp)).toEqual([])
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!gitAvailable)('getGitInfo', () => {
  it('reports branch and isWorktree=false for main repo', () => {
    const repo = makeRepo()
    try {
      const info = getGitInfo(repo)
      expect(info).not.toBeNull()
      expect(info!.branch).toBe('main')
      expect(info!.isWorktree).toBe(false)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it('reports isWorktree=true inside a linked worktree', () => {
    const repo = makeRepo()
    try {
      const wtPath = createWorktree(repo, 'feature-b', 'main')
      const info = getGitInfo(wtPath)
      expect(info).not.toBeNull()
      expect(info!.branch).toBe('feature-b')
      expect(info!.isWorktree).toBe(true)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns null for a non-git path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-nogit-'))
    try {
      expect(getGitInfo(tmp)).toBeNull()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!gitAvailable)('resolveWorktreeCwd', () => {
  it('returns an existing path as-is without touching git', () => {
    const repo = makeRepo()
    try {
      expect(resolveWorktreeCwd(repo)).toBe(repo)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it('recreates directory when git still lists the worktree', () => {
    const repo = makeRepo()
    try {
      const wtPath = createWorktree(repo, 'feature-c', 'main')
      // Manually delete the directory without `git worktree remove` — git still records it.
      fs.rmSync(wtPath, { recursive: true, force: true })
      expect(fs.existsSync(wtPath)).toBe(false)

      const resolved = resolveWorktreeCwd(wtPath)
      expect(resolved).toBe(wtPath)
      expect(fs.existsSync(wtPath)).toBe(true)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns null for a path with no git ancestor', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesole-nogit-'))
    try {
      const missing = path.join(tmp, 'does', 'not', 'exist')
      expect(resolveWorktreeCwd(missing)).toBeNull()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe.skipIf(gitAvailable)('git probe', () => {
  it('skips git-dependent tests when git is missing', () => {
    // Placeholder so the file always has at least one visible describe block.
    expect(true).toBe(true)
  })
})
