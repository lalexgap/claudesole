import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { Session } from '../store/sessions'
import { Worktree } from '../types/ipc'

interface Props {
  sessions: Session[]
  onOpenSession: (cwd: string) => void
  onClose: () => void
}

interface ConfirmState {
  worktreePath: string
  stage: 'confirm' | 'force'
}

const HOME = typeof process !== 'undefined' ? (process.env['HOME'] ?? '') : ''

function shortenPath(p: string): string {
  if (HOME && p.startsWith(HOME)) return '~' + p.slice(HOME.length)
  return p
}

function repoName(repoRoot: string): string {
  return repoRoot.split('/').filter(Boolean).pop() ?? repoRoot
}

export function WorktreePanel({ sessions, onOpenSession, onClose }: Props) {
  const [worktreesByRepo, setWorktreesByRepo] = useState<Map<string, Worktree[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [removing, setRemoving] = useState<Set<string>>(new Set())

  const openCwds = new Set(sessions.map(s => s.cwd))
  const sessionByCwd = new Map(sessions.map(s => [s.cwd, s]))

  // Only re-fetch when the set of cwds changes, not on every status update
  const cwdKey = [...new Set(sessions.map(s => s.cwd))].sort().join('|')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const uniqueCwds = [...new Set(sessions.map(s => s.cwd))]
      const allWorktrees: Worktree[] = []

      await Promise.all(uniqueCwds.map(async (cwd) => {
        try {
          const wts = await window.electronAPI.listWorktrees(cwd)
          allWorktrees.push(...wts)
        } catch {
          // ignore errors per cwd
        }
      }))

      // Deduplicate by path, group by repoRoot — skip main worktrees
      const seen = new Set<string>()
      const byRepo = new Map<string, Worktree[]>()
      for (const wt of allWorktrees) {
        if (wt.isMain || seen.has(wt.path)) continue
        seen.add(wt.path)
        const list = byRepo.get(wt.repoRoot) ?? []
        list.push(wt)
        byRepo.set(wt.repoRoot, list)
      }

      setWorktreesByRepo(byRepo)
      setLoading(false)
    }

    load()
  }, [cwdKey])

  const handleRemoveClick = (wt: Worktree) => {
    setConfirm({ worktreePath: wt.path, stage: 'confirm' })
    setErrors(prev => {
      const next = new Map(prev)
      next.delete(wt.path)
      return next
    })
  }

  const handleConfirmYes = async (wt: Worktree, force: boolean) => {
    setConfirm(null)
    setRemoving(prev => new Set([...prev, wt.path]))
    try {
      await window.electronAPI.removeWorktree(wt.repoRoot, wt.path, force)
      // Remove from local state
      setWorktreesByRepo(prev => {
        const next = new Map(prev)
        const list = next.get(wt.repoRoot)
        if (list) {
          const filtered = list.filter(w => w.path !== wt.path)
          if (filtered.length === 0) next.delete(wt.repoRoot)
          else next.set(wt.repoRoot, filtered)
        }
        return next
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!force) {
        setConfirm({ worktreePath: wt.path, stage: 'force' })
        setErrors(prev => {
          const next = new Map(prev)
          next.set(wt.path, msg)
          return next
        })
      } else {
        setErrors(prev => {
          const next = new Map(prev)
          next.set(wt.path, msg)
          return next
        })
      }
    } finally {
      setRemoving(prev => {
        const next = new Set(prev)
        next.delete(wt.path)
        return next
      })
    }
  }

  const handleConfirmNo = () => {
    setConfirm(null)
  }

  const btnCls = 'bg-white/[0.06] border border-app-500 rounded text-[#888] text-[11px] cursor-pointer px-[7px] leading-4'
  const dangerBtnCls = 'bg-red-400/[0.08] border border-red-400/30 rounded text-red-400 text-[11px] cursor-pointer px-[7px] leading-4'

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[340px] bg-app-800 border-l border-app-500 flex flex-col overflow-hidden z-10">
      {/* Header */}
      <div className="flex items-center px-3.5 py-2.5 border-b border-app-650 shrink-0">
        <span className="text-[#555] text-[13px] mr-1.5">⎇</span>
        <span className="flex-1 text-xs font-semibold text-[#bbb] uppercase tracking-[0.08em]">
          Git Worktrees
        </span>
        <button
          onClick={onClose}
          className="bg-transparent border-0 text-[#666] text-base cursor-pointer leading-none px-0.5"
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-3.5 py-4 text-[#555] text-xs">
            Loading worktrees…
          </div>
        )}

        {!loading && worktreesByRepo.size === 0 && (
          <div className="px-3.5 py-4 text-[#555] text-xs">
            No linked worktrees found. Create one with{' '}
            <code className="font-mono bg-white/[0.06] px-1 rounded-sm">git worktree add</code>{' '}
            or use --worktree when starting a session.
          </div>
        )}

        {!loading && [...worktreesByRepo.entries()].map(([repoRoot, worktrees]) => (
          <div key={repoRoot}>
            {/* Repo section header */}
            <div className="px-3.5 pt-2 pb-1 text-[10px] text-[#555] font-semibold uppercase tracking-[0.08em] border-t border-app-650">
              {repoName(repoRoot)}
              <span className="text-[#3a3a3a] font-normal ml-1.5 normal-case tracking-normal">
                {shortenPath(repoRoot)}
              </span>
            </div>

            {worktrees.map(wt => {
              const hasOpenSession = openCwds.has(wt.path)
              const openSession = sessionByCwd.get(wt.path)
              const isRemoving = removing.has(wt.path)
              const confirmingThis = confirm?.worktreePath === wt.path
              const errorMsg = errors.get(wt.path)

              return (
                <div key={wt.path} className="px-3.5 py-2 border-b border-app-700">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className={clsx(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      hasOpenSession ? 'bg-green-400' : 'bg-[#333]'
                    )} />
                    <span className={clsx(
                      'text-[13px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap',
                      wt.branch ? 'text-neutral-200' : 'text-[#666] italic'
                    )}>
                      {wt.branch ?? 'detached'}
                    </span>
                  </div>

                  <div className="text-[10px] text-[#555] ml-3 overflow-hidden text-ellipsis whitespace-nowrap">
                    {shortenPath(wt.path)}
                  </div>
                  {openSession && (
                    <div className="text-[11px] text-[#888] ml-3 mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                      {openSession.aiTitle || openSession.label}
                    </div>
                  )}
                  {(confirmingThis || errorMsg) && <div className="mb-1.5" />}

                  {errorMsg && !confirmingThis && (
                    <div className="text-[11px] text-red-400 ml-3 mb-1">{errorMsg}</div>
                  )}

                  <div className="flex gap-1.5 ml-3 items-center">
                    {confirmingThis ? (
                      <>
                        <span className="text-[11px] text-[#aaa]">
                          {confirm.stage === 'force' ? 'Force remove?' : 'Remove?'}
                        </span>
                        {confirm.stage === 'force' && errorMsg && (
                          <span
                            className="text-[10px] text-red-400 max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap"
                            title={errorMsg}
                          >
                            {errorMsg}
                          </span>
                        )}
                        <button
                          onClick={() => handleConfirmYes(wt, confirm.stage === 'force')}
                          className={confirm.stage === 'force' ? dangerBtnCls : btnCls}
                        >
                          Yes
                        </button>
                        <button onClick={handleConfirmNo} className={btnCls}>
                          No
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => onOpenSession(wt.path)}
                          className={btnCls}
                          title={`Open session in ${wt.path}`}
                        >
                          Open
                        </button>
                        <button
                          onClick={() => handleRemoveClick(wt)}
                          className={dangerBtnCls}
                          disabled={isRemoving}
                          title={`Remove worktree ${wt.path}`}
                        >
                          {isRemoving ? 'Removing…' : 'Remove'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {/* Prune stale note */}
        {!loading && [...worktreesByRepo.values()].some(list => list.some(wt => wt.branch === null && !wt.isMain)) && (
          <div className="mx-3.5 my-3 px-2.5 py-2 bg-amber-400/[0.08] border border-amber-400/20 rounded text-[11px] text-amber-400 leading-[1.5]">
            Some worktrees have no branch (detached HEAD). Run{' '}
            <code className="font-mono bg-white/[0.08] px-1 rounded-sm">
              git worktree prune
            </code>{' '}
            to remove stale entries.
          </div>
        )}
      </div>
    </div>
  )
}
