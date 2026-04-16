import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useSessionsStore } from '../store/sessions'

export interface TerminalHandle {
  findNext: (query: string, opts?: { incremental?: boolean }) => boolean
  findPrevious: (query: string) => boolean
  scrollToBottom: () => void
}

export function useTerminal(
  sessionId: string,
  containerRef: React.RefObject<HTMLDivElement>,
  onCmdF: () => void,
  onCmdK: () => void,
  handleRef: React.MutableRefObject<TerminalHandle | null>,
  isShell = false,
  isActive = false,
) {
  const markRunning = useSessionsStore((s) => s.markRunning)
  const markWaiting = useSessionsStore((s) => s.markWaiting)
  const setUserHasTyped = useSessionsStore((s) => s.setUserHasTyped)
  const setFirstPrompt = useSessionsStore((s) => s.setFirstPrompt)
  const hasMarkedUserTypedRef = useRef(false)
  const hasSetFirstPromptRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifiedIdleRef = useRef(false)
  const suppressRunningUntil = useRef(0)
  const claudeRespondedRef = useRef(false) // true only when Claude (not echo) sent data since last idle
  const userActedRef = useRef(false) // true after user types; gates notification reset
  const onCmdFRef = useRef(onCmdF)
  const onCmdKRef = useRef(onCmdK)
  const markRunningRef = useRef(markRunning)
  const markWaitingRef = useRef(markWaiting)
  const isShellRef = useRef(isShell)
  const isActiveRef = useRef(isActive)
  useEffect(() => { onCmdFRef.current = onCmdF })
  useEffect(() => { onCmdKRef.current = onCmdK })
  useEffect(() => { markRunningRef.current = markRunning })
  useEffect(() => { markWaitingRef.current = markWaiting })
  useEffect(() => { isShellRef.current = isShell })
  useEffect(() => { isActiveRef.current = isActive })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let hoveredUrl: string | null = null

    const term = new Terminal({
      // Required for SearchAddon.findNext decorations (registerDecoration is
      // still proposed API in xterm.js). Without this, find silently throws.
      allowProposedApi: true,
      theme: {
        background: '#1a1a1a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
      },
      fontFamily: '"Hack Nerd Font Mono", "MesloLGS NF", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      // Handle OSC 8 hyperlinks (emitted by Claude CLI etc.) via cmd+click
      linkHandler: {
        activate: () => { /* handled by mousedown listener below */ },
        hover: (_event, uri) => { hoveredUrl = uri },
        leave: () => { hoveredUrl = null },
      },
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon(
      () => { /* handled by mousedown listener below */ },
      {
        hover: (_e, uri) => { hoveredUrl = uri },
        leave: () => { hoveredUrl = null },
      }
    )
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(webLinksAddon)
    term.open(container)

    const onMouseDown = (e: MouseEvent) => {
      if (e.metaKey && hoveredUrl) {
        window.electronAPI.openExternal(hoveredUrl)
        e.preventDefault()
      }
    }
    container.addEventListener('mousedown', onMouseDown)
    fitAddon.fit()

    handleRef.current = {
      findNext: (q, opts) => searchAddon.findNext(q, { decorations: searchDecorations, incremental: opts?.incremental }),
      findPrevious: (q) => searchAddon.findPrevious(q, { decorations: searchDecorations }),
      scrollToBottom: () => term.scrollToBottom(),
    }

    term.attachCustomKeyEventHandler(e => {
      if (e.metaKey && e.key === 'f' && e.type === 'keydown') {
        onCmdFRef.current()
        return false
      }
      // ⌘K opens quick switcher
      if (e.metaKey && e.key === 'k' && e.type === 'keydown') {
        onCmdKRef.current()
        return false
      }
      return true
    })

    const sendResize = () => {
      if (term.cols > 0 && term.rows > 0) {
        window.electronAPI.resizeSession(sessionId, term.cols, term.rows)
      }
    }
    sendResize()

    let inputBuffer = ''

    term.onData((data) => {
      window.electronAPI.writeSession(sessionId, data)
      // Suppress green flash: echoes of user input arrive within ~10ms
      suppressRunningUntil.current = Date.now() + 150
      userActedRef.current = true
      if (!hasMarkedUserTypedRef.current) {
        hasMarkedUserTypedRef.current = true
        setUserHasTyped(sessionId)
      }
      // Capture the user's first prompt from keystrokes so title generation
      // doesn't need to read from disk (avoids same-cwd race conditions).
      if (!hasSetFirstPromptRef.current) {
        for (const char of data) {
          if (char === '\r' || char === '\n') {
            if (inputBuffer.trim()) {
              hasSetFirstPromptRef.current = true
              setFirstPrompt(sessionId, inputBuffer.trim())
            }
            inputBuffer = ''
            break
          } else if (char === '\x7f') {
            inputBuffer = inputBuffer.slice(0, -1)
          } else if (char === '\x03' || char === '\x1b') {
            inputBuffer = ''
            break
          } else if (char.charCodeAt(0) >= 32) {
            inputBuffer += char
          }
        }
      }
    })

    // Request notification permission on first use
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const removeDataListener = window.electronAPI.onData((id, data) => {
      if (id !== sessionId) return
      term.write(data)

      const isClaudeData = Date.now() > suppressRunningUntil.current
      if (isClaudeData) {
        markRunningRef.current(id)
        // Only reset notification gate if the user has actually typed since the last notification.
        // This prevents spurious PTY output (e.g. resize redraws) from re-arming the notification.
        if (userActedRef.current) {
          claudeRespondedRef.current = true
          notifiedIdleRef.current = false
          userActedRef.current = false
        }
      }

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        markWaitingRef.current(id)
        const shouldNotify =
          !isShellRef.current &&
          claudeRespondedRef.current &&
          !notifiedIdleRef.current &&
          (!isActiveRef.current || !document.hasFocus()) &&
          Notification.permission === 'granted'
        claudeRespondedRef.current = false
        if (shouldNotify) {
          const label = useSessionsStore.getState().sessions.find(s => s.id === id)?.label ?? 'Claude'
          new Notification('Claude is waiting', { body: `${label} finished and is waiting for input`, silent: false })
          notifiedIdleRef.current = true
        }
      }, 500)
    })

    const resizeObserver = new ResizeObserver(() => {
      // Preserve scroll position across fit() — xterm resets to top on reflow.
      // Capture distance from bottom before resize, then restore after xterm's
      // render cycle completes (rAF ensures the reflow has settled).
      const distanceFromBottom = term.buffer.active.baseY - term.buffer.active.viewportY
      fitAddon.fit()
      sendResize()
      requestAnimationFrame(() => {
        term.scrollToBottom()
        if (distanceFromBottom > 0) term.scrollLines(-distanceFromBottom)
      })
    })
    resizeObserver.observe(container)

    return () => {
      handleRef.current = null
      removeDataListener()
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      resizeObserver.disconnect()
      container.removeEventListener('mousedown', onMouseDown)
      term.dispose()
    }
  }, [sessionId])
}

// Addon typings require 6-char hex (#RRGGBB) for background colors; earlier
// 8-char values (#RRGGBBAA) were silently rejected and no highlight rendered.
const searchDecorations = {
  matchBackground: '#665800',
  matchBorder: '#f6f6a0',
  matchOverviewRuler: '#f6f6a0',
  activeMatchBackground: '#aa4800',
  activeMatchBorder: '#ff8000',
  activeMatchColorOverviewRuler: '#ff8000',
}
