import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import { ClaudeSession, CodexSession } from '../types/ipc'

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
  | { type: 'codexSession'; session: CodexSession }
  | { type: 'folder'; cwd: string }
  | { type: 'codexFolder'; cwd: string }
  | { type: 'browse' }
  | { type: 'codexBrowse' }
  | { type: 'shellFolder'; cwd: string }
  | { type: 'shellBrowse' }

export interface SessionOpts { skipPermissions: boolean; worktree: boolean; branch?: string }

interface Props {
  onResume: (session: ClaudeSession, opts: SessionOpts) => void
  onResumeCodex: (session: CodexSession, opts: SessionOpts) => void
  onNewInFolder: (cwd: string, opts: SessionOpts) => void
  onNewCodexInFolder: (cwd: string, opts: SessionOpts) => void
  onNewShell: (cwd: string) => void
  onShellBrowse: () => void
  onClose: () => void
}

export function NewSessionModal({ onResume, onResumeCodex, onNewInFolder, onNewCodexInFolder, onNewShell, onShellBrowse, onClose }: Props) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([])
  const [codexSessions, setCodexSessions] = useState<CodexSession[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [hoveredSession, setHoveredSession] = useState<ClaudeSession | CodexSession | null>(null)
  const [skipPermissions, setSkipPermissions] = useState(true)
  const [summaries, setSummaries] = useState<Record<string, string>>({})

  const [step, setStep] = useState<'pick' | 'options'>('pick')
  const [pendingCwd, setPendingCwd] = useState<string | null>(null)
  const [pendingType, setPendingType] = useState<'claude' | 'codex'>('claude')
  const [worktree, setWorktree] = useState(false)
  const [branchSearch, setBranchSearch] = useState('')
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [branchOpen, setBranchOpen] = useState(false)
  const [branchIdx, setBranchIdx] = useState(0)

  const searchRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    searchRef.current?.focus()
    window.electronAPI.listSessions().then(all =>
      setSessions(all.filter(s => !s.cwd.includes('/.claude/worktrees/')))
    ).catch(() => {})
    window.electronAPI.listCodexSessions().then(all => setCodexSessions(all)).catch(() => {})
  }, [])

  const q = query.toLowerCase()

  const filteredSessions = useMemo(() => sessions.filter(s =>
    !q ||
    s.projectName.toLowerCase().includes(q) ||
    s.slug.toLowerCase().includes(q) ||
    s.cwd.toLowerCase().includes(q) ||
    s.firstPrompt.toLowerCase().includes(q) ||
    (s.title || '').toLowerCase().includes(q)
  ), [sessions, q])

  const filteredCodexSessions = useMemo(() => codexSessions.filter(s =>
    !q ||
    s.projectName.toLowerCase().includes(q) ||
    s.slug.toLowerCase().includes(q) ||
    s.cwd.toLowerCase().includes(q) ||
    s.firstPrompt.toLowerCase().includes(q) ||
    (s.title || '').toLowerCase().includes(q)
  ), [codexSessions, q])

  const recentFolders = useMemo(() => [...new Set(sessions.map(s => s.cwd))]
    .filter(cwd => !q || cwd.toLowerCase().includes(q))
    .slice(0, 3), [sessions, q])

  const recentCodexFolders = useMemo(() => [...new Set(codexSessions.map(s => s.cwd))]
    .filter(cwd => !q || cwd.toLowerCase().includes(q))
    .slice(0, 3), [codexSessions, q])

  const items: Item[] = useMemo(() => [
    ...filteredSessions.map(s => ({ type: 'session' as const, session: s })),
    ...filteredCodexSessions.map(s => ({ type: 'codexSession' as const, session: s })),
    ...recentFolders.map(cwd => ({ type: 'folder' as const, cwd })),
    { type: 'browse' },
    ...recentCodexFolders.map(cwd => ({ type: 'codexFolder' as const, cwd })),
    { type: 'codexBrowse' },
    ...recentFolders.map(cwd => ({ type: 'shellFolder' as const, cwd })),
    { type: 'shellBrowse' },
  ], [filteredSessions, filteredCodexSessions, recentFolders, recentCodexFolders])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    itemRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const activeSession: ClaudeSession | CodexSession | null =
    hoveredSession ??
    (selected < filteredSessions.length
      ? filteredSessions[selected]
      : selected < filteredSessions.length + filteredCodexSessions.length
        ? filteredCodexSessions[selected - filteredSessions.length]
        : null)

  useEffect(() => {
    if (!activeSession || !activeSession.firstPrompt) return
    const id = activeSession.sessionId
    const hasCachedSummary = 'summary' in activeSession ? !!activeSession.summary : false
    if (summaries[id] || hasCachedSummary) return
    window.electronAPI.generateSessionSummary(id, activeSession.firstPrompt, activeSession.latestPrompt || undefined)
      .then(s => { if (s) setSummaries(prev => ({ ...prev, [id]: s })) })
      .catch(() => {})
  }, [activeSession?.sessionId])

  const branchInputRef = useRef<HTMLInputElement>(null)
  const branchListRef = useRef<HTMLDivElement>(null)

  const filteredBranches = useMemo(() =>
    branches.filter(b => !branchSearch || b.toLowerCase().includes(branchSearch.toLowerCase())),
    [branches, branchSearch]
  )

  useEffect(() => {
    if (worktree && pendingCwd) {
      window.electronAPI.listBranches(pendingCwd).then(bs => { setBranches(bs); setBranchIdx(0) }).catch(() => {})
    } else {
      setBranches([])
    }
  }, [worktree, pendingCwd])

  useEffect(() => {
    branchListRef.current?.children[branchIdx]?.scrollIntoView({ block: 'nearest' })
  }, [branchIdx])

  const goToOptions = async (cwd?: string, type: 'claude' | 'codex' = 'claude') => {
    let target = cwd
    if (!target) {
      target = await window.electronAPI.openDirectory() ?? undefined
      if (!target) return
    }
    setPendingCwd(target)
    setPendingType(type)
    setWorktree(false)
    setBranchSearch('')
    setBranch('')
    setBranches([])
    setBranchOpen(false)
    setStep('options')
  }

  const handleStart = useCallback(() => {
    if (!pendingCwd) return
    const opts = { skipPermissions, worktree, branch: worktree && branch ? branch : undefined }
    if (pendingType === 'codex') onNewCodexInFolder(pendingCwd, opts)
    else onNewInFolder(pendingCwd, opts)
  }, [pendingCwd, pendingType, skipPermissions, worktree, branch, onNewInFolder, onNewCodexInFolder])

  const cycleSection = useCallback((reverse: boolean) => {
    const fOffset = filteredSessions.length
    const sfOffset = fOffset + recentFolders.length + 1
    const sections = [
      ...(filteredSessions.length > 0 ? [0] : []),
      fOffset,
      sfOffset,
    ]
    setSelected(cur => {
      const currentIdx = sections.reduce((acc, start, i) => cur >= start ? i : acc, 0)
      const nextIdx = reverse
        ? (currentIdx - 1 + sections.length) % sections.length
        : (currentIdx + 1) % sections.length
      return sections[nextIdx]
    })
  }, [filteredSessions.length, recentFolders.length])

  const activate = useCallback((item: Item) => {
    if (item.type === 'session') onResume(item.session, { skipPermissions, worktree: false })
    else if (item.type === 'codexSession') onResumeCodex(item.session, { skipPermissions, worktree: false })
    else if (item.type === 'folder') goToOptions(item.cwd, 'claude')
    else if (item.type === 'browse') goToOptions(undefined, 'claude')
    else if (item.type === 'codexFolder') goToOptions(item.cwd, 'codex')
    else if (item.type === 'codexBrowse') goToOptions(undefined, 'codex')
    else if (item.type === 'shellFolder') onNewShell(item.cwd)
    else onShellBrowse()
  }, [onResume, onResumeCodex, onNewShell, onShellBrowse, skipPermissions])

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
        if (e.key === 'Enter') { e.preventDefault(); const b = filteredBranches[branchIdx]; if (b) { setBranch(b); setBranchSearch(b); setBranchOpen(false) } }
        if (e.key === 'Escape') { e.preventDefault(); setBranchOpen(false) }
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setStep('pick') }
      if (e.key === 'Enter') { e.preventDefault(); handleStart() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, branchOpen, branchIdx, filteredBranches, handleStart])

  const sessionOffset = 0
  const codexSessionOffset = filteredSessions.length
  const folderOffset = codexSessionOffset + filteredCodexSessions.length
  const browseOffset = folderOffset + recentFolders.length
  const codexFolderOffset = browseOffset + 1
  const codexBrowseOffset = codexFolderOffset + recentCodexFolders.length
  const shellFolderOffset = codexBrowseOffset + 1
  const shellBrowseOffset = shellFolderOffset + recentFolders.length

  const rowCls = (idx: number) => clsx(
    'px-3 py-2 cursor-pointer rounded-md mx-1 my-px',
    selected === idx ? 'bg-white/[0.07]' : 'bg-transparent'
  )

  const shortenParent = (cwd: string) => {
    const parts = cwd.split('/')
    const parent = parts.slice(0, -1).join('/')
    const username = parts[2] ?? ''
    return parent.replace(`/Users/${username}`, '~')
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/65 flex items-start justify-center pt-16 z-[1000]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex h-[680px] w-[960px] max-h-[calc(100vh-8rem)] max-w-[calc(100vw-4rem)] bg-app-750 rounded-xl border border-app-450 shadow-[0_24px_64px_rgba(0,0,0,0.6)] overflow-hidden"
      >
        {step === 'pick' ? (
          /* ── Step 1: Session / folder picker ── */
          <div className="w-[420px] flex flex-col border-r border-app-550">
            <div className="shrink-0 border-b border-app-550">
              <div className="px-3.5 pt-3 pb-2.5">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); cycleSection(e.shiftKey) } }}
                  placeholder="Search sessions…"
                  className="w-full bg-transparent border-0 outline-none text-neutral-200 text-sm"
                />
              </div>
              <div className="px-3.5 pb-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={e => setSkipPermissions(e.target.checked)}
                    className="accent-green-400 cursor-pointer"
                  />
                  <span className="text-[#777] text-[11px]">--dangerously-skip-permissions</span>
                </label>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {filteredSessions.length > 0 && (
                <>
                  <SectionLabel>Resume session</SectionLabel>
                  {filteredSessions.map((session, i) => (
                    <div
                      key={session.sessionId}
                      ref={el => { if (el) itemRefs.current.set(sessionOffset + i, el); else itemRefs.current.delete(sessionOffset + i) }}
                      className={rowCls(sessionOffset + i)}
                      onClick={() => onResume(session, { skipPermissions, worktree: false })}
                      onMouseEnter={() => { setSelected(sessionOffset + i); setHoveredSession(session) }}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-neutral-300 font-medium text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">
                          {session.title || session.slug || session.projectName}
                        </span>
                        <span className="text-[#666] text-[11px] ml-auto shrink-0">
                          {relativeTime(session.lastActivity)}
                        </span>
                      </div>
                      <div className="text-[#777] text-[11px] mt-px overflow-hidden text-ellipsis whitespace-nowrap">
                        {session.projectName}{session.slug ? ` · ${session.cwd}` : ''}
                      </div>
                      {(session.latestPrompt || session.firstPrompt) && (
                        <div className="text-[#888] text-[11px] leading-[1.5] mt-[3px] line-clamp-2">
                          {session.latestPrompt || session.firstPrompt}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
              {filteredCodexSessions.length > 0 && (
                <>
                  <SectionLabel>Resume Codex session</SectionLabel>
                  {filteredCodexSessions.map((session, i) => (
                    <div
                      key={session.sessionId}
                      ref={el => { if (el) itemRefs.current.set(codexSessionOffset + i, el); else itemRefs.current.delete(codexSessionOffset + i) }}
                      className={rowCls(codexSessionOffset + i)}
                      onClick={() => onResumeCodex(session, { skipPermissions, worktree: false })}
                      onMouseEnter={() => { setSelected(codexSessionOffset + i); setHoveredSession(session) }}
                      onMouseLeave={() => setHoveredSession(null)}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-purple-400 text-[10px] font-mono shrink-0">[cx]</span>
                        <span className="text-neutral-300 font-medium text-[13px] overflow-hidden text-ellipsis whitespace-nowrap">
                          {session.title || session.slug || session.projectName}
                        </span>
                        <span className="text-[#666] text-[11px] ml-auto shrink-0">
                          {relativeTime(session.lastActivity)}
                        </span>
                      </div>
                      <div className="text-[#777] text-[11px] mt-px overflow-hidden text-ellipsis whitespace-nowrap">
                        {session.projectName}{session.slug ? ` · ${session.cwd}` : ''}
                      </div>
                      {(session.latestPrompt || session.firstPrompt) && (
                        <div className="text-[#888] text-[11px] leading-[1.5] mt-[3px] line-clamp-2">
                          {session.latestPrompt || session.firstPrompt}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
              {filteredSessions.length === 0 && filteredCodexSessions.length === 0 && (
                <div className="p-4 text-[#555] text-xs">
                  {query ? 'No matching sessions' : 'No recent sessions found'}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-app-550">
              <SectionLabel style={{ paddingTop: '6px', paddingBottom: '2px' }}>New session</SectionLabel>
              {recentFolders.map((cwd, i) => (
                <div
                  key={cwd}
                  ref={el => { if (el) itemRefs.current.set(folderOffset + i, el); else itemRefs.current.delete(folderOffset + i) }}
                  className={clsx(rowCls(folderOffset + i), 'flex items-center gap-2 !py-[5px]')}
                  onClick={() => goToOptions(cwd)}
                  onMouseEnter={() => { setSelected(folderOffset + i); setHoveredSession(null) }}
                >
                  <span className="text-green-400 text-[11px] shrink-0">+</span>
                  <span className="text-neutral-300 text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                    {cwd.split('/').pop()}
                  </span>
                  <span className="text-[#555] text-[10px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">
                    {shortenParent(cwd)}
                  </span>
                </div>
              ))}
              <div
                ref={el => { if (el) itemRefs.current.set(browseOffset, el); else itemRefs.current.delete(browseOffset) }}
                className={clsx(rowCls(browseOffset), 'flex items-center gap-2 !py-[5px] !mb-0.5')}
                onClick={() => goToOptions()}
                onMouseEnter={() => { setSelected(browseOffset); setHoveredSession(null) }}
              >
                <span className="text-[#555] text-xs">⊕</span>
                <span className="text-[#888] text-xs">Browse for folder…</span>
              </div>

              <SectionLabel style={{ paddingTop: '4px', paddingBottom: '2px' }}>New Codex session</SectionLabel>
              {recentCodexFolders.map((cwd, i) => (
                <div
                  key={cwd}
                  ref={el => { if (el) itemRefs.current.set(codexFolderOffset + i, el); else itemRefs.current.delete(codexFolderOffset + i) }}
                  className={clsx(rowCls(codexFolderOffset + i), 'flex items-center gap-2 !py-[5px]')}
                  onClick={() => goToOptions(cwd, 'codex')}
                  onMouseEnter={() => { setSelected(codexFolderOffset + i); setHoveredSession(null) }}
                >
                  <span className="text-purple-400 text-[11px] shrink-0">+</span>
                  <span className="text-neutral-300 text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                    {cwd.split('/').pop()}
                  </span>
                  <span className="text-[#555] text-[10px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">
                    {shortenParent(cwd)}
                  </span>
                </div>
              ))}
              <div
                ref={el => { if (el) itemRefs.current.set(codexBrowseOffset, el); else itemRefs.current.delete(codexBrowseOffset) }}
                className={clsx(rowCls(codexBrowseOffset), 'flex items-center gap-2 !py-[5px] !mb-0.5')}
                onClick={() => goToOptions(undefined, 'codex')}
                onMouseEnter={() => { setSelected(codexBrowseOffset); setHoveredSession(null) }}
              >
                <span className="text-[#555] text-xs">⊕</span>
                <span className="text-[#888] text-xs">Codex in folder…</span>
              </div>

              <SectionLabel style={{ paddingTop: '4px', paddingBottom: '2px' }}>New shell</SectionLabel>
              {recentFolders.map((cwd, i) => (
                <div
                  key={cwd}
                  ref={el => { if (el) itemRefs.current.set(shellFolderOffset + i, el); else itemRefs.current.delete(shellFolderOffset + i) }}
                  className={clsx(rowCls(shellFolderOffset + i), 'flex items-center gap-2 !py-[5px]')}
                  onClick={() => onNewShell(cwd)}
                  onMouseEnter={() => { setSelected(shellFolderOffset + i); setHoveredSession(null) }}
                >
                  <span className="text-blue-400 text-[11px] shrink-0 font-mono">$</span>
                  <span className="text-neutral-300 text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                    {cwd.split('/').pop()}
                  </span>
                  <span className="text-[#555] text-[10px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">
                    {shortenParent(cwd)}
                  </span>
                </div>
              ))}
              <div
                ref={el => { if (el) itemRefs.current.set(shellBrowseOffset, el); else itemRefs.current.delete(shellBrowseOffset) }}
                className={clsx(rowCls(shellBrowseOffset), 'flex items-center gap-2 !py-[5px] !mb-1')}
                onClick={onShellBrowse}
                onMouseEnter={() => { setSelected(shellBrowseOffset); setHoveredSession(null) }}
              >
                <span className="text-blue-400 text-[11px] font-mono">$</span>
                <span className="text-[#888] text-xs">Shell in folder…</span>
              </div>
            </div>
          </div>
        ) : (
          /* ── Step 2: New session options ── */
          <div className="w-[420px] flex flex-col border-r border-app-550">
            <div className="shrink-0 border-b border-app-550 px-3.5 py-3">
              <button
                onClick={() => setStep('pick')}
                className="bg-transparent border-0 text-[#888] cursor-pointer text-[13px] p-0 flex items-center gap-1.5"
              >
                ← Back
              </button>
            </div>

            <div className="flex-1 px-4 py-5 flex flex-col gap-5">
              <div>
                <div className="text-[#666] text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5">
                  New {pendingType === 'codex' ? 'Codex' : 'Claude'} session in
                </div>
                <div className="text-neutral-200 text-[13px] font-medium">{pendingCwd?.split('/').pop()}</div>
                <div className="text-[#555] text-[11px] mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap">{pendingCwd}</div>
              </div>

              <div className="flex flex-col gap-2.5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipPermissions}
                    onChange={e => setSkipPermissions(e.target.checked)}
                    className="accent-green-400 cursor-pointer"
                  />
                  <span className="text-[#777] text-[11px]">
                    {pendingType === 'codex' ? '--dangerously-bypass-approvals-and-sandbox' : '--dangerously-skip-permissions'}
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={worktree}
                    onChange={e => setWorktree(e.target.checked)}
                    className="accent-blue-400 cursor-pointer"
                  />
                  <span className="text-[#777] text-[11px]">--worktree</span>
                </label>
                {worktree && (
                  <div className="relative ml-5">
                    <input
                      ref={branchInputRef}
                      value={branchSearch}
                      onChange={e => { setBranchSearch(e.target.value); setBranch(''); setBranchOpen(true); setBranchIdx(0) }}
                      onFocus={() => setBranchOpen(true)}
                      onBlur={() => setTimeout(() => setBranchOpen(false), 150)}
                      placeholder="Branch (optional)…"
                      className={clsx(
                        'w-full box-border bg-app-600 border border-app-350 rounded text-xs px-2 py-[5px] outline-none',
                        branch ? 'text-neutral-200' : 'text-[#aaa]'
                      )}
                    />
                    {branchOpen && filteredBranches.length > 0 && (
                      <div
                        ref={branchListRef}
                        className="absolute top-[calc(100%+4px)] left-0 right-0 z-10 bg-app-600 border border-app-350 rounded max-h-[140px] overflow-y-auto shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                      >
                        {filteredBranches.map((b, i) => (
                          <div
                            key={b}
                            onMouseDown={e => { e.preventDefault(); setBranch(b); setBranchSearch(b); setBranchOpen(false) }}
                            className={clsx(
                              'px-2 py-[5px] text-xs cursor-pointer',
                              i === branchIdx ? 'bg-white/[0.07] text-neutral-200' : 'bg-transparent text-[#aaa]'
                            )}
                          >
                            {b}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-app-550 px-4 py-3">
              <button
                onClick={handleStart}
                className="w-full py-2 px-4 bg-blue-700 border-0 rounded-md text-neutral-200 text-[13px] font-medium cursor-pointer"
              >
                Start session
              </button>
            </div>
          </div>
        )}

        {/* Right panel */}
        <div className="flex-1 p-5 flex flex-col gap-3 overflow-y-auto">
          {step === 'pick' ? (
            <>
              {!activeSession && (
                <div className="text-[#444] text-xs mt-2">Select a session to see details</div>
              )}
              {activeSession && (<>
                <div>
                  <div className="text-neutral-200 font-semibold text-[13px] mb-0.5">
                    {activeSession.title || activeSession.slug || activeSession.projectName}
                  </div>
                  {activeSession.slug && (
                    <div className="text-[#888] text-[11px]">{activeSession.projectName}</div>
                  )}
                </div>
                {(summaries[activeSession.sessionId] || activeSession.summary) && (
                  <div className="text-[#777] text-[11px] leading-relaxed italic">
                    {summaries[activeSession.sessionId] || activeSession.summary}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <DetailLabel>Location</DetailLabel>
                  <div className="text-[#999] text-[11px] break-all">{activeSession.cwd}</div>
                </div>
                <div className="flex flex-col gap-1">
                  <DetailLabel>Last active</DetailLabel>
                  <div className="text-[#999] text-[11px]">{relativeTime(activeSession.lastActivity)}</div>
                </div>
                {activeSession.latestPrompt && activeSession.latestPrompt !== activeSession.firstPrompt && (
                  <div className="flex flex-col gap-1">
                    <DetailLabel>Last prompt</DetailLabel>
                    <div className="text-[#aaa] text-[11px] leading-relaxed line-clamp-5">
                      {activeSession.latestPrompt}
                    </div>
                  </div>
                )}
                {activeSession.firstPrompt && (
                  <div className="flex flex-col gap-1">
                    <DetailLabel>First prompt</DetailLabel>
                    <div className="text-[#666] text-[11px] leading-relaxed line-clamp-5">
                      {activeSession.firstPrompt}
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <DetailLabel>Session ID</DetailLabel>
                  <div className="text-[#555] text-[10px] break-all">
                    {activeSession.sessionId}
                  </div>
                </div>
              </>)}
            </>
          ) : (
            <>
              <DetailLabel>--worktree</DetailLabel>
              <div className="text-[#666] text-[11px] leading-[1.7]">
                {worktree && branch
                  ? <>Checks out <span className="text-[#aaa]">{branch}</span> in an isolated worktree at <span className="text-[#aaa]">.claude/worktrees/{branch.replace(/\//g, '-')}</span>.</>
                  : 'Runs Claude in an isolated git worktree. Pick a branch to check it out there, or leave blank for an auto-named branch.'
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
    <div
      className="px-4 pt-2 pb-[3px] text-[10px] text-[#666] font-semibold uppercase tracking-[0.08em]"
      style={style}
    >
      {children}
    </div>
  )
}

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] text-[#666] font-semibold uppercase tracking-[0.08em]">
      {children}
    </div>
  )
}
