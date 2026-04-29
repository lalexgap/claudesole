import React, { useState, useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { Session } from '../store/sessions'
import { ClaudeSession, Worktree } from '../types/ipc'
import { confirm as confirmDialog, toast } from '../store/ui'

interface Props {
  sessions: Session[]
  onOpenSession: (cwd: string) => void
  onClose: () => void
}

const HOME = typeof process !== 'undefined' ? (process.env['HOME'] ?? '') : ''

function shortenPath(p: string): string {
  if (HOME && p.startsWith(HOME)) return '~' + p.slice(HOME.length)
  return p
}

function repoName(repoRoot: string): string {
  return repoRoot.split('/').filter(Boolean).pop() ?? repoRoot
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

export function WorktreePanel({ sessions, onOpenSession, onClose }: Props) {
  const [worktreesByRepo, setWorktreesByRepo] = useState<Map<string, Worktree[]>>(new Map())
  const [allSessions, setAllSessions] = useState<ClaudeSession[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Worktree | null>(null)
  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  const openCwds = useMemo(() => new Set(sessions.map(s => s.cwd)), [sessions])
  const sessionByCwd = useMemo(() => new Map(sessions.map(s => [s.cwd, s])), [sessions])

  // Re-fetch worktrees when the set of cwds changes (not on every status update).
  const cwdKey = [...new Set(sessions.map(s => s.cwd))].sort().join('|')

  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const uniqueCwds = [...new Set(sessions.map(s => s.cwd))]
      const allWts: Worktree[] = []
      await Promise.all(uniqueCwds.map(async (cwd) => {
        try {
          const wts = await window.electronAPI.listWorktrees(cwd)
          allWts.push(...wts)
        } catch {}
      }))

      const seen = new Set<string>()
      const byRepo = new Map<string, Worktree[]>()
      for (const wt of allWts) {
        if (wt.isMain || seen.has(wt.path)) continue
        seen.add(wt.path)
        const list = byRepo.get(wt.repoRoot) ?? []
        list.push(wt)
        byRepo.set(wt.repoRoot, list)
      }
      for (const list of byRepo.values()) {
        list.sort((a, b) => (a.branch ?? '').localeCompare(b.branch ?? ''))
      }
      if (!cancelled) {
        setWorktreesByRepo(byRepo)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [cwdKey])

  useEffect(() => {
    let cancelled = false
    window.electronAPI.listSessions()
      .then(s => { if (!cancelled) setAllSessions(s) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filteredByRepo = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return worktreesByRepo
    const out = new Map<string, Worktree[]>()
    for (const [repo, wts] of worktreesByRepo) {
      const repoMatch = repoName(repo).toLowerCase().includes(q) || repo.toLowerCase().includes(q)
      const filtered = wts.filter(wt =>
        repoMatch ||
        (wt.branch ?? '').toLowerCase().includes(q) ||
        wt.path.toLowerCase().includes(q),
      )
      if (filtered.length > 0) out.set(repo, filtered)
    }
    return out
  }, [query, worktreesByRepo])

  const totalFiltered = useMemo(() => {
    let n = 0
    for (const list of filteredByRepo.values()) n += list.length
    return n
  }, [filteredByRepo])

  // If the selected worktree filters out, drop the selection.
  useEffect(() => {
    if (!selected) return
    let stillVisible = false
    for (const list of filteredByRepo.values()) {
      if (list.some(w => w.path === selected.path)) { stillVisible = true; break }
    }
    if (!stillVisible) setSelected(null)
  }, [filteredByRepo, selected])

  const sessionsInSelectedCwd = useMemo(() => {
    if (!selected) return [] as ClaudeSession[]
    return allSessions
      .filter(s => s.cwd === selected.path)
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }, [selected?.path, allSessions])

  const dropFromState = (wt: Worktree) => {
    setWorktreesByRepo(prev => {
      const next = new Map(prev)
      const list = next.get(wt.repoRoot)
      if (!list) return prev
      const filtered = list.filter(w => w.path !== wt.path)
      if (filtered.length === 0) next.delete(wt.repoRoot)
      else next.set(wt.repoRoot, filtered)
      return next
    })
    if (selected?.path === wt.path) setSelected(null)
  }

  const handleRemove = async (wt: Worktree) => {
    const ok = await confirmDialog({
      title: 'Remove worktree?',
      message: `${shortenPath(wt.path)}\nAny uncommitted changes will be lost.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!ok) return

    setRemoving(prev => new Set([...prev, wt.path]))
    try {
      await window.electronAPI.removeWorktree(wt.repoRoot, wt.path, false)
      dropFromState(wt)
      toast.success(`Removed ${wt.branch ?? shortenPath(wt.path)}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const forceOk = await confirmDialog({
        title: 'Force remove?',
        message: `${msg}\n\nForce removal will discard the worktree's contents.`,
        confirmLabel: 'Force remove',
        tone: 'danger',
      })
      if (!forceOk) return
      try {
        await window.electronAPI.removeWorktree(wt.repoRoot, wt.path, true)
        dropFromState(wt)
        toast.success(`Forcibly removed ${wt.branch ?? shortenPath(wt.path)}`)
      } catch (e2) {
        toast.error(`Failed to remove: ${e2 instanceof Error ? e2.message : e2}`)
      }
    } finally {
      setRemoving(prev => {
        const next = new Set(prev)
        next.delete(wt.path)
        return next
      })
    }
  }

  const hasDetached = !loading && [...worktreesByRepo.values()].some(list =>
    list.some(wt => wt.branch === null && !wt.isMain),
  )

  return (
    <div className="absolute inset-0 bg-app-900 flex flex-col z-50">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-app-700">
        <span className="text-[#555] text-xs font-semibold uppercase tracking-[0.08em] shrink-0">
          Worktrees
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by branch or path…"
          className="flex-1 bg-white/[0.05] border border-app-500 rounded-md px-2.5 py-[5px] text-neutral-200 text-[13px] outline-none"
        />
        <button
          onClick={onClose}
          className="bg-transparent border-0 text-[#555] text-lg cursor-pointer leading-none shrink-0"
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className="w-[340px] shrink-0 border-r border-app-800 overflow-y-auto py-2">
          {loading && (
            <div className="px-4 py-6 text-[#444] text-[13px]">Loading worktrees…</div>
          )}

          {!loading && worktreesByRepo.size === 0 && (
            <div className="px-4 py-6 text-[#444] text-[13px] leading-[1.6]">
              No linked worktrees found. Create one with{' '}
              <code className="font-mono bg-white/[0.06] px-1 rounded-sm">git worktree add</code>{' '}
              or use --worktree when starting a session.
            </div>
          )}

          {!loading && worktreesByRepo.size > 0 && totalFiltered === 0 && (
            <div className="px-4 py-6 text-[#444] text-[13px]">No matching worktrees</div>
          )}

          {!loading && [...filteredByRepo.entries()].map(([repoRoot, worktrees]) => (
            <div key={repoRoot}>
              <div className="px-4 pt-2 pb-1 text-[10px] text-[#444] font-semibold uppercase tracking-[0.08em]">
                {repoName(repoRoot)}
                <span className="text-[#3a3a3a] font-normal ml-1.5 normal-case tracking-normal">
                  {shortenPath(repoRoot)}
                </span>
              </div>
              {worktrees.map(wt => {
                const hasOpenSession = openCwds.has(wt.path)
                const openSession = sessionByCwd.get(wt.path)
                const isSelected = selected?.path === wt.path
                return (
                  <div
                    key={wt.path}
                    onClick={() => setSelected(wt)}
                    onDoubleClick={() => onOpenSession(wt.path)}
                    className={clsx(
                      'px-4 py-[7px] cursor-pointer border-l-2 flex items-start gap-1.5',
                      isSelected ? 'bg-white/[0.07] border-[#555]' : 'bg-transparent border-transparent',
                    )}
                  >
                    <div className={clsx(
                      'w-1.5 h-1.5 rounded-full shrink-0 mt-1.5',
                      hasOpenSession ? 'bg-green-400' : 'bg-[#333]',
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className={clsx(
                        'text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap',
                        wt.branch
                          ? (isSelected ? 'text-neutral-200' : 'text-[#bbb]')
                          : 'text-[#666] italic',
                      )}>
                        {wt.branch ?? 'detached'}
                      </div>
                      <div className="text-[#666] text-[11px] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                        {shortenPath(wt.path)}
                      </div>
                      {openSession && (
                        <div className="text-[#888] text-[11px] mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
                          {openSession.aiTitle || openSession.label}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {hasDetached && (
            <div className="mx-3.5 my-3 px-2.5 py-2 bg-amber-400/[0.08] border border-amber-400/20 rounded text-[11px] text-amber-400 leading-[1.5]">
              Some worktrees have no branch (detached HEAD). Run{' '}
              <code className="font-mono bg-white/[0.08] px-1 rounded-sm">git worktree prune</code>{' '}
              to remove stale entries.
            </div>
          )}
        </div>

        {/* Detail */}
        {selected ? (
          <div className="flex-1 px-7 py-6 overflow-y-auto flex flex-col gap-5">
            <div className="flex items-start gap-2.5">
              <div className="flex-1 min-w-0">
                <div className={clsx(
                  'text-lg font-semibold mb-1 break-all',
                  selected.branch ? 'text-neutral-200' : 'text-[#666] italic',
                )}>
                  {selected.branch ?? 'detached'}
                </div>
                <div className="text-[#666] text-[13px]">{repoName(selected.repoRoot)}</div>
              </div>
              {openCwds.has(selected.path) && (
                <span className="text-[10px] uppercase tracking-[0.05em] px-2 py-0.5 rounded-sm bg-green-400/[0.12] border border-green-400/30 text-green-400 shrink-0">
                  Open
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Path</Label>
              <div className="text-[#888] text-xs break-all">{selected.path}</div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Repo</Label>
              <div className="text-[#888] text-xs break-all">{selected.repoRoot}</div>
            </div>

            {sessionByCwd.get(selected.path) && (
              <div className="flex flex-col gap-1.5">
                <Label>Open session</Label>
                <div className="text-[#888] text-xs">
                  {sessionByCwd.get(selected.path)!.aiTitle || sessionByCwd.get(selected.path)!.label}
                </div>
              </div>
            )}

            {sessionsInSelectedCwd.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>Past sessions ({sessionsInSelectedCwd.length})</Label>
                <div className="text-[#888] text-xs">
                  Latest: {relativeTime(sessionsInSelectedCwd[0].lastActivity)}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-1 flex-wrap">
              <ActionButton primary onClick={() => onOpenSession(selected.path)}>
                Open in new tab
              </ActionButton>
              <ActionButton
                onClick={() => handleRemove(selected)}
                disabled={removing.has(selected.path)}
                danger
              >
                {removing.has(selected.path) ? 'Removing…' : 'Remove worktree'}
              </ActionButton>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#333] text-[13px]">
            Select a worktree to view details
          </div>
        )}
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-[#555] font-semibold uppercase tracking-[0.08em]">
      {children}
    </div>
  )
}

function ActionButton({
  children, onClick, primary, danger, disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className={clsx(
        'px-4 py-[7px] rounded-md text-xs font-[inherit] transition-colors duration-150',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        primary
          ? clsx('border-0', hov && !disabled ? 'bg-green-400/[0.25] text-green-400' : 'bg-green-400/[0.15] text-green-400')
          : danger
          ? clsx('border', hov && !disabled ? 'border-red-400/50 bg-red-400/[0.12] text-red-400' : 'border-red-400/30 bg-red-400/[0.06] text-red-400')
          : clsx('border border-app-500', hov && !disabled ? 'bg-white/[0.08] text-[#888]' : 'bg-white/[0.04] text-[#888]'),
      )}
    >
      {children}
    </button>
  )
}
