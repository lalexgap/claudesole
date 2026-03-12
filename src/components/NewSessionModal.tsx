import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ClaudeSession } from '../types/ipc'

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

type Item =
  | { type: 'session'; session: ClaudeSession }
  | { type: 'folder'; cwd: string }
  | { type: 'browse' }
  | { type: 'shellFolder'; cwd: string }
  | { type: 'shellBrowse' }

export interface SessionOpts { skipPermissions: boolean; worktree: boolean; newBranchName?: string; baseBranch?: string }

interface Props {
  onResume: (session: ClaudeSession, opts: SessionOpts) => void
  onNewInFolder: (cwd: string, opts: SessionOpts) => void
  onNewShell: (cwd: string) => void
  onShellBrowse: () => void
  onClose: () => void
}

export function NewSessionModal({ onResume, onNewInFolder, onNewShell, onShellBrowse, onClose }: Props) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [hoveredSession, setHoveredSession] = useState<ClaudeSession | null>(null)
  const [skipPermissions, setSkipPermissions] = useState(true)

  const [step, setStep] = useState<'pick' | 'options'>('pick')
  const [pendingCwd, setPendingCwd] = useState<string | null>(null)
  const [worktree, setWorktree] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [baseBranchSearch, setBaseBranchSearch] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branchOpen, setBranchOpen] = useState(false)
  const [branchIdx, setBranchIdx] = useState(0)

  const searchRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    searchRef.current?.focus()
    window.electronAPI.listSessions().then(setSessions)
  }, [])

  const q = query.toLowerCase()

  const filteredSessions = useMemo(() => sessions.filter(s =>
    !q ||
    s.projectName.toLowerCase().includes(q) ||
    s.slug.toLowerCase().includes(q) ||
    s.cwd.toLowerCase().includes(q) ||
    s.firstPrompt.toLowerCase().includes(q)
  ), [sessions, q])

  const recentFolders = useMemo(() => [...new Set(sessions.map(s => s.cwd))]
    .filter(cwd => !q || cwd.toLowerCase().includes(q))
    .slice(0, 3), [sessions, q])

  const items: Item[] = useMemo(() => [
    ...filteredSessions.map(s => ({ type: 'session' as const, session: s })),
    ...recentFolders.map(cwd => ({ type: 'folder' as const, cwd })),
    { type: 'browse' },
    ...recentFolders.map(cwd => ({ type: 'shellFolder' as const, cwd })),
    { type: 'shellBrowse' },
  ], [filteredSessions, recentFolders])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    itemRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const activeSession: ClaudeSession | null =
    hoveredSession ??
    (selected < filteredSessions.length ? filteredSessions[selected] : null)

  const branchInputRef = useRef<HTMLInputElement>(null)
  const newBranchRef = useRef<HTMLInputElement>(null)
  const branchListRef = useRef<HTMLDivElement>(null)

  const filteredBranches = useMemo(() =>
    branches.filter(b => !baseBranchSearch || b.toLowerCase().includes(baseBranchSearch.toLowerCase())),
    [branches, baseBranchSearch]
  )

  useEffect(() => {
    if (worktree && pendingCwd) {
      window.electronAPI.listBranches(pendingCwd).then(bs => { setBranches(bs); setBranchIdx(0) })
    } else {
      setBranches([])
    }
  }, [worktree, pendingCwd])

  useEffect(() => {
    branchListRef.current?.children[branchIdx]?.scrollIntoView({ block: 'nearest' })
  }, [branchIdx])

  const goToOptions = async (cwd?: string) => {
    let target = cwd
    if (!target) {
      target = await window.electronAPI.openDirectory() ?? undefined
      if (!target) return
    }
    setPendingCwd(target)
    setWorktree(false)
    setNewBranchName('')
    setBaseBranchSearch('')
    setBaseBranch('')
    setBranches([])
    setBranchOpen(false)
    setStep('options')
  }

  const handleStart = useCallback(() => {
    if (!pendingCwd) return
    onNewInFolder(pendingCwd, {
      skipPermissions,
      worktree,
      newBranchName: worktree && newBranchName ? newBranchName : undefined,
      baseBranch: worktree && baseBranch ? baseBranch : undefined,
    })
  }, [pendingCwd, skipPermissions, worktree, newBranchName, baseBranch, onNewInFolder])

  const activate = useCallback((item: Item) => {
    if (item.type === 'session') onResume(item.session, { skipPermissions, worktree: false })
    else if (item.type === 'folder') goToOptions(item.cwd)
    else if (item.type === 'browse') goToOptions()
    else if (item.type === 'shellFolder') onNewShell(item.cwd)
    else onShellBrowse()
  }, [onResume, onNewShell, onShellBrowse, skipPermissions])

  useEffect(() => {
    if (step !== 'pick') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter') { e.preventDefault(); const item = items[selected]; if (item) activate(item) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, items, selected, activate, onClose])

  useEffect(() => {
    if (step !== 'options') return
    const onKey = (e: KeyboardEvent) => {
      if (branchOpen) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setBranchIdx(i => Math.min(i + 1, filteredBranches.length - 1)) }
        if (e.key === 'ArrowUp') { e.preventDefault(); setBranchIdx(i => Math.max(i - 1, 0)) }
        if (e.key === 'Enter') { e.preventDefault(); const b = filteredBranches[branchIdx]; if (b) { setBaseBranch(b); setBaseBranchSearch(b); setBranchOpen(false) } }
        if (e.key === 'Escape') { e.preventDefault(); setBranchOpen(false) }
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setStep('pick') }
      if (e.key === 'Enter' && document.activeElement !== newBranchRef.current) { e.preventDefault(); handleStart() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, branchOpen, branchIdx, filteredBranches, handleStart])

  const sessionOffset = 0
  const folderOffset = filteredSessions.length
  const browseOffset = folderOffset + recentFolders.length
  const shellFolderOffset = browseOffset + 1
  const shellBrowseOffset = shellFolderOffset + recentFolders.length

  const rowStyle = (idx: number): React.CSSProperties => ({
    padding: '8px 12px',
    cursor: 'pointer',
    background: selected === idx ? 'rgba(255,255,255,0.07)' : 'transparent',
    borderRadius: '6px',
    margin: '1px 4px',
  })

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '80px',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex',
          height: '520px',
          background: '#1c1c1c',
          borderRadius: '12px',
          border: '1px solid #323232',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        {step === 'pick' ? (
          /* ── Step 1: Session / folder picker ── */
          <div style={{ width: '360px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, borderBottom: '1px solid #272727' }}>
              <div style={{ padding: '12px 14px 10px' }}>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search sessions…"
                  style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: '#e5e5e5', fontSize: '14px' }}
                />
              </div>
              <div style={{ padding: '0 14px 10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={e => setSkipPermissions(e.target.checked)}
                    style={{ accentColor: '#4ade80', cursor: 'pointer' }}
                  />
                  <span style={{ color: '#777', fontSize: '11px' }}>--dangerously-skip-permissions</span>
                </label>
              </div>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {filteredSessions.length > 0 && (
                <>
                  <SectionLabel>Resume session</SectionLabel>
                  {filteredSessions.map((session, i) => (
                    <div
                      key={session.sessionId}
                      ref={el => { if (el) itemRefs.current.set(sessionOffset + i, el); else itemRefs.current.delete(sessionOffset + i) }}
                      style={rowStyle(sessionOffset + i)}
                      onClick={() => onResume(session, { skipPermissions, worktree: false })}
                      onMouseEnter={() => { setSelected(sessionOffset + i); setHoveredSession(session) }}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                        <span style={{ color: '#d4d4d4', fontWeight: 500, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {session.slug || session.projectName}
                        </span>
                        <span style={{ color: '#666', fontSize: '11px', marginLeft: 'auto', flexShrink: 0 }}>
                          {relativeTime(session.lastActivity)}
                        </span>
                      </div>
                      <div style={{ color: '#777', fontSize: '11px', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.projectName}{session.slug ? ` · ${session.cwd}` : ''}
                      </div>
                      {(session.latestPrompt || session.firstPrompt) && (
                        <div style={{
                          color: '#888', fontSize: '11px', lineHeight: '1.5', marginTop: '3px',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        } as React.CSSProperties}>
                          {session.latestPrompt || session.firstPrompt}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
              {filteredSessions.length === 0 && (
                <div style={{ padding: '16px', color: '#555', fontSize: '12px' }}>
                  {query ? 'No matching sessions' : 'No recent sessions found'}
                </div>
              )}
            </div>

            <div style={{ flexShrink: 0, borderTop: '1px solid #272727' }}>
              <SectionLabel style={{ paddingTop: '6px', paddingBottom: '2px' }}>New session</SectionLabel>
              {recentFolders.map((cwd, i) => (
                <div
                  key={cwd}
                  ref={el => { if (el) itemRefs.current.set(folderOffset + i, el); else itemRefs.current.delete(folderOffset + i) }}
                  style={{ ...rowStyle(folderOffset + i), display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px' }}
                  onClick={() => goToOptions(cwd)}
                  onMouseEnter={() => { setSelected(folderOffset + i); setHoveredSession(null) }}
                >
                  <span style={{ color: '#4ade80', fontSize: '11px', flexShrink: 0 }}>+</span>
                  <span style={{ color: '#d4d4d4', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {cwd.split('/').pop()}
                  </span>
                  <span style={{ color: '#555', fontSize: '10px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                    {cwd.split('/').slice(0, -1).join('/').replace('/Users/' + cwd.split('/')[2], '~')}
                  </span>
                </div>
              ))}
              <div
                ref={el => { if (el) itemRefs.current.set(browseOffset, el); else itemRefs.current.delete(browseOffset) }}
                style={{ ...rowStyle(browseOffset), display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px', margin: '1px 4px 2px' }}
                onClick={() => goToOptions()}
                onMouseEnter={() => { setSelected(browseOffset); setHoveredSession(null) }}
              >
                <span style={{ color: '#555', fontSize: '12px' }}>⊕</span>
                <span style={{ color: '#888', fontSize: '12px' }}>Browse for folder…</span>
              </div>

              <SectionLabel style={{ paddingTop: '4px', paddingBottom: '2px' }}>New shell</SectionLabel>
              {recentFolders.map((cwd, i) => (
                <div
                  key={cwd}
                  ref={el => { if (el) itemRefs.current.set(shellFolderOffset + i, el); else itemRefs.current.delete(shellFolderOffset + i) }}
                  style={{ ...rowStyle(shellFolderOffset + i), display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px' }}
                  onClick={() => onNewShell(cwd)}
                  onMouseEnter={() => { setSelected(shellFolderOffset + i); setHoveredSession(null) }}
                >
                  <span style={{ color: '#60a5fa', fontSize: '11px', flexShrink: 0, fontFamily: 'monospace' }}>$</span>
                  <span style={{ color: '#d4d4d4', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {cwd.split('/').pop()}
                  </span>
                  <span style={{ color: '#555', fontSize: '10px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                    {cwd.split('/').slice(0, -1).join('/').replace('/Users/' + cwd.split('/')[2], '~')}
                  </span>
                </div>
              ))}
              <div
                ref={el => { if (el) itemRefs.current.set(shellBrowseOffset, el); else itemRefs.current.delete(shellBrowseOffset) }}
                style={{ ...rowStyle(shellBrowseOffset), display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 12px', margin: '1px 4px 4px' }}
                onClick={onShellBrowse}
                onMouseEnter={() => { setSelected(shellBrowseOffset); setHoveredSession(null) }}
              >
                <span style={{ color: '#60a5fa', fontSize: '11px', fontFamily: 'monospace' }}>$</span>
                <span style={{ color: '#888', fontSize: '12px' }}>Shell in folder…</span>
              </div>
            </div>
          </div>
        ) : (
          /* ── Step 2: New session options ── */
          <div style={{ width: '360px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, borderBottom: '1px solid #272727', padding: '12px 14px' }}>
              <button
                onClick={() => setStep('pick')}
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '13px', padding: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                ← Back
              </button>
            </div>

            <div style={{ flex: 1, padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <div style={{ color: '#666', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>New session in</div>
                <div style={{ color: '#e5e5e5', fontSize: '13px', fontWeight: 500 }}>{pendingCwd?.split('/').pop()}</div>
                <div style={{ color: '#555', fontSize: '11px', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingCwd}</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={e => setSkipPermissions(e.target.checked)}
                    style={{ accentColor: '#4ade80', cursor: 'pointer' }}
                  />
                  <span style={{ color: '#777', fontSize: '11px' }}>--dangerously-skip-permissions</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={worktree}
                    onChange={e => setWorktree(e.target.checked)}
                    style={{ accentColor: '#60a5fa', cursor: 'pointer' }}
                  />
                  <span style={{ color: '#777', fontSize: '11px' }}>--worktree</span>
                </label>
                {worktree && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '20px' }}>
                    <div style={{ position: 'relative' }}>
                      <div style={{ color: '#555', fontSize: '10px', marginBottom: '3px' }}>Base branch</div>
                      <input
                        ref={branchInputRef}
                        value={baseBranchSearch}
                        onChange={e => { setBaseBranchSearch(e.target.value); setBaseBranch(''); setBranchOpen(true); setBranchIdx(0) }}
                        onFocus={() => setBranchOpen(true)}
                        onBlur={() => setTimeout(() => setBranchOpen(false), 150)}
                        placeholder="Select base branch…"
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          background: '#252525', border: '1px solid #3a3a3a', borderRadius: '5px',
                          color: baseBranch ? '#e5e5e5' : '#aaa', fontSize: '12px',
                          padding: '5px 8px', outline: 'none',
                        }}
                      />
                      {branchOpen && filteredBranches.length > 0 && (
                        <div
                          ref={branchListRef}
                          style={{
                            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 10,
                            background: '#252525', border: '1px solid #3a3a3a', borderRadius: '5px',
                            maxHeight: '140px', overflowY: 'auto',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                          }}
                        >
                          {filteredBranches.map((b, i) => (
                            <div
                              key={b}
                              onMouseDown={e => { e.preventDefault(); setBaseBranch(b); setBaseBranchSearch(b); setBranchOpen(false) }}
                              style={{
                                padding: '5px 8px', fontSize: '12px', cursor: 'pointer',
                                color: i === branchIdx ? '#e5e5e5' : '#aaa',
                                background: i === branchIdx ? 'rgba(255,255,255,0.07)' : 'transparent',
                              }}
                            >
                              {b}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <div style={{ color: '#555', fontSize: '10px', marginBottom: '3px' }}>New branch name</div>
                      <input
                        ref={newBranchRef}
                        value={newBranchName}
                        onChange={e => setNewBranchName(e.target.value)}
                        placeholder="e.g. feature/my-changes"
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          background: '#252525', border: '1px solid #3a3a3a', borderRadius: '5px',
                          color: newBranchName ? '#e5e5e5' : '#aaa', fontSize: '12px',
                          padding: '5px 8px', outline: 'none',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ flexShrink: 0, borderTop: '1px solid #272727', padding: '12px 16px' }}>
              <button
                onClick={handleStart}
                style={{
                  width: '100%', padding: '8px 16px',
                  background: '#1d4ed8', border: 'none', borderRadius: '6px',
                  color: '#e5e5e5', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
                }}
              >
                Start session
              </button>
            </div>
          </div>
        )}

        {/* Right panel */}
        <div style={{ width: '280px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', borderLeft: '1px solid #272727' }}>
          {step === 'pick' ? (
            <>
              {!activeSession && (
                <div style={{ color: '#444', fontSize: '12px', marginTop: '8px' }}>Select a session to see details</div>
              )}
              {activeSession && (<>
                <div>
                  <div style={{ color: '#e5e5e5', fontWeight: 600, fontSize: '13px', marginBottom: '2px' }}>
                    {activeSession.slug || activeSession.projectName}
                  </div>
                  {activeSession.slug && (
                    <div style={{ color: '#888', fontSize: '11px' }}>{activeSession.projectName}</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <DetailLabel>Location</DetailLabel>
                  <div style={{ color: '#999', fontSize: '11px', wordBreak: 'break-all' }}>{activeSession.cwd}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <DetailLabel>Last active</DetailLabel>
                  <div style={{ color: '#999', fontSize: '11px' }}>{relativeTime(activeSession.lastActivity)}</div>
                </div>
                {activeSession.latestPrompt && activeSession.latestPrompt !== activeSession.firstPrompt && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <DetailLabel>Last prompt</DetailLabel>
                    <div style={{
                      color: '#aaa', fontSize: '11px', lineHeight: '1.6',
                      display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    } as React.CSSProperties}>
                      {activeSession.latestPrompt}
                    </div>
                  </div>
                )}
                {activeSession.firstPrompt && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <DetailLabel>First prompt</DetailLabel>
                    <div style={{
                      color: '#666', fontSize: '11px', lineHeight: '1.6',
                      display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    } as React.CSSProperties}>
                      {activeSession.firstPrompt}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <DetailLabel>Session ID</DetailLabel>
                  <div style={{ color: '#555', fontSize: '10px', wordBreak: 'break-all' }}>
                    {activeSession.sessionId}
                  </div>
                </div>
              </>)}
            </>
          ) : (
            <>
              <DetailLabel>--worktree</DetailLabel>
              <div style={{ color: '#666', fontSize: '11px', lineHeight: '1.7' }}>
                {worktree && baseBranch && newBranchName
                  ? <>Creates worktree <span style={{ color: '#aaa' }}>.claude/worktrees/{newBranchName}</span> branching off <span style={{ color: '#aaa' }}>{baseBranch}</span>.</>
                  : worktree
                  ? 'Select a base branch and enter a new branch name to create an isolated worktree.'
                  : 'Enable --worktree for isolated parallel work. Automatically cleaned up if no changes are made.'
                }
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      padding: '8px 16px 3px',
      fontSize: '10px',
      color: '#666',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      ...style,
    }}>
      {children}
    </div>
  )
}

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {children}
    </div>
  )
}
