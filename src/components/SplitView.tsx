import { useState, useRef, useCallback } from 'react'
import { Session } from '../store/sessions'
import { TerminalView } from './TerminalView'

// ── Pane tree types ─────────────────────────────────────────────────────────

export type PaneLeaf = { type: 'leaf'; sessionId: string }
export type PaneSplit = {
  type: 'split'
  dir: 'h' | 'v'   // h = side-by-side, v = stacked
  ratio: number     // fraction of space given to `first` (0–1)
  first: PaneNode
  second: PaneNode
}
export type PaneNode = PaneLeaf | PaneSplit

// ── Tree helpers ─────────────────────────────────────────────────────────────

export function getLeafIds(node: PaneNode): string[] {
  if (node.type === 'leaf') return [node.sessionId]
  return [...getLeafIds(node.first), ...getLeafIds(node.second)]
}

export function splitLeaf(
  root: PaneNode,
  targetId: string,
  dir: 'h' | 'v',
  newId: string,
): PaneNode {
  if (root.type === 'leaf') {
    if (root.sessionId !== targetId) return root
    return { type: 'split', dir, ratio: 0.5, first: root, second: { type: 'leaf', sessionId: newId } }
  }
  return {
    ...root,
    first: splitLeaf(root.first, targetId, dir, newId),
    second: splitLeaf(root.second, targetId, dir, newId),
  }
}

export function removeFromTree(root: PaneNode, sessionId: string): PaneNode | null {
  if (root.type === 'leaf') return root.sessionId === sessionId ? null : root
  const first = removeFromTree(root.first, sessionId)
  const second = removeFromTree(root.second, sessionId)
  if (first === null) return second
  if (second === null) return first
  return { ...root, first, second }
}

// ── Components ───────────────────────────────────────────────────────────────

interface SplitViewProps {
  node: PaneNode
  sessions: Session[]
  focusedId: string | null
  onFocus: (id: string) => void
}

export function SplitView({ node, sessions, focusedId, onFocus }: SplitViewProps) {
  if (node.type === 'leaf') {
    const session = sessions.find(s => s.id === node.sessionId)
    const isFocused = node.sessionId === focusedId
    return (
      <div
        onClick={() => onFocus(node.sessionId)}
        style={{
          width: '100%', height: '100%', position: 'relative',
          outline: isFocused ? '1px solid rgba(74,222,128,0.35)' : '1px solid #1e1e1e',
          outlineOffset: '-1px',
        }}
      >
        <TerminalView
          sessionId={node.sessionId}
          isActive={isFocused}
          isShell={session?.type === 'shell'}
        />
      </div>
    )
  }

  return <SplitNode node={node} sessions={sessions} focusedId={focusedId} onFocus={onFocus} />
}

function SplitNode({ node, sessions, focusedId, onFocus }: { node: PaneSplit } & Omit<SplitViewProps, 'node'>) {
  const [ratio, setRatio] = useState(node.ratio)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = node.dir === 'h' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const r = node.dir === 'h'
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height
      setRatio(Math.max(0.1, Math.min(0.9, r)))
    }
    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [node.dir])

  const isH = node.dir === 'h'
  const DIVIDER = 5

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: isH ? 'row' : 'column' }}
    >
      {/* First pane */}
      <div style={{
        [isH ? 'width' : 'height']: `calc(${ratio * 100}% - ${DIVIDER / 2}px)`,
        flexShrink: 0, overflow: 'hidden', position: 'relative',
      }}>
        <SplitView node={node.first} sessions={sessions} focusedId={focusedId} onFocus={onFocus} />
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onDividerMouseDown}
        style={{
          [isH ? 'width' : 'height']: `${DIVIDER}px`,
          flexShrink: 0,
          background: '#1a1a1a',
          cursor: isH ? 'col-resize' : 'row-resize',
          zIndex: 10,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#333')}
        onMouseLeave={e => (e.currentTarget.style.background = '#1a1a1a')}
      />

      {/* Second pane */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <SplitView node={node.second} sessions={sessions} focusedId={focusedId} onFocus={onFocus} />
      </div>
    </div>
  )
}
