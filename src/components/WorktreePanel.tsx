import { useState, useEffect } from 'react'
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

  const buttonStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid #2a2a2a',
    borderRadius: '4px',
    color: '#888',
    fontSize: '11px',
    cursor: 'pointer',
    padding: '2px 7px',
    lineHeight: '16px',
  }

  const dangerButtonStyle = {
    ...buttonStyle,
    color: '#f87171',
    borderColor: 'rgba(248,113,113,0.3)',
    background: 'rgba(248,113,113,0.08)',
  }

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: '340px',
      background: '#1a1a1a',
      borderLeft: '1px solid #2a2a2a',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 10,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        borderBottom: '1px solid #222',
        flexShrink: 0,
      }}>
        <span style={{ color: '#555', fontSize: '13px', marginRight: '6px' }}>⎇</span>
        <span style={{
          flex: 1,
          fontSize: '12px',
          fontWeight: 600,
          color: '#bbb',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          Git Worktrees
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            fontSize: '16px',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '0 2px',
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '16px 14px', color: '#555', fontSize: '12px' }}>
            Loading worktrees…
          </div>
        )}

        {!loading && worktreesByRepo.size === 0 && (
          <div style={{ padding: '16px 14px', color: '#555', fontSize: '12px' }}>
            No linked worktrees found. Create one with <code style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: '3px' }}>git worktree add</code> or use --worktree when starting a session.
          </div>
        )}

        {!loading && [...worktreesByRepo.entries()].map(([repoRoot, worktrees]) => (
          <div key={repoRoot}>
            {/* Repo section header */}
            <div style={{
              padding: '8px 14px 4px',
              fontSize: '10px',
              color: '#555',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              borderTop: '1px solid #222',
            }}>
              {repoName(repoRoot)}
              <span style={{ color: '#3a3a3a', fontWeight: 400, marginLeft: '6px', textTransform: 'none', letterSpacing: 0 }}>
                {shortenPath(repoRoot)}
              </span>
            </div>

            {worktrees.map(wt => {
              const hasOpenSession = openCwds.has(wt.path)
              const isRemoving = removing.has(wt.path)
              const confirmingThis = confirm?.worktreePath === wt.path
              const errorMsg = errors.get(wt.path)

              return (
                <div key={wt.path} style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid #1e1e1e',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    {/* Green dot for open session */}
                    <div style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: hasOpenSession ? '#4ade80' : '#333',
                      flexShrink: 0,
                    }} />

                    {/* Branch name */}
                    <span style={{
                      fontSize: '13px',
                      color: wt.branch ? '#e5e5e5' : '#666',
                      fontStyle: wt.branch ? 'normal' : 'italic',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {wt.branch ?? 'detached'}
                    </span>

                  </div>

                  {/* Path */}
                  <div style={{
                    fontSize: '10px',
                    color: '#555',
                    marginLeft: '12px',
                    marginBottom: confirmingThis || errorMsg ? '6px' : 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {shortenPath(wt.path)}
                  </div>

                  {/* Error message */}
                  {errorMsg && !confirmingThis && (
                    <div style={{ fontSize: '11px', color: '#f87171', marginLeft: '12px', marginBottom: '4px' }}>
                      {errorMsg}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '6px', marginLeft: '12px', alignItems: 'center' }}>
                      {confirmingThis ? (
                        <>
                          <span style={{ fontSize: '11px', color: '#aaa' }}>
                            {confirm.stage === 'force' ? 'Force remove?' : 'Remove?'}
                          </span>
                          {confirm.stage === 'force' && errorMsg && (
                            <span style={{ fontSize: '10px', color: '#f87171', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={errorMsg}>
                              {errorMsg}
                            </span>
                          )}
                          <button
                            onClick={() => handleConfirmYes(wt, confirm.stage === 'force')}
                            style={confirm.stage === 'force' ? dangerButtonStyle : buttonStyle}
                          >
                            Yes
                          </button>
                          <button onClick={handleConfirmNo} style={buttonStyle}>
                            No
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => onOpenSession(wt.path)}
                            style={buttonStyle}
                            title={`Open session in ${wt.path}`}
                          >
                            Open
                          </button>
                          <button
                            onClick={() => handleRemoveClick(wt)}
                            style={dangerButtonStyle}
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
          <div style={{
            margin: '12px 14px',
            padding: '8px 10px',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: '5px',
            fontSize: '11px',
            color: '#fbbf24',
            lineHeight: 1.5,
          }}>
            Some worktrees have no branch (detached HEAD). Run{' '}
            <code style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: '3px' }}>
              git worktree prune
            </code>{' '}
            to remove stale entries.
          </div>
        )}
      </div>
    </div>
  )
}
