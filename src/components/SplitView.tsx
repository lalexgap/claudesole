import { useState } from 'react'

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

export function splitLeaf(root: PaneNode, targetId: string, dir: 'h' | 'v', newId: string): PaneNode {
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

export function replaceLeaf(root: PaneNode, targetId: string, newId: string): PaneNode {
  if (root.type === 'leaf') return root.sessionId === targetId ? { type: 'leaf', sessionId: newId } : root
  return { ...root, first: replaceLeaf(root.first, targetId, newId), second: replaceLeaf(root.second, targetId, newId) }
}

export function removeFromTree(root: PaneNode, sessionId: string): PaneNode | null {
  if (root.type === 'leaf') return root.sessionId === sessionId ? null : root
  const first = removeFromTree(root.first, sessionId)
  const second = removeFromTree(root.second, sessionId)
  if (first === null) return second
  if (second === null) return first
  return { ...root, first, second }
}

export function updateRatioAtPath(node: PaneNode, path: string, newRatio: number): PaneNode {
  if (node.type === 'leaf') return node
  if (path === '') return { ...node, ratio: newRatio }
  if (path[0] === 'L') return { ...node, first: updateRatioAtPath(node.first, path.slice(1), newRatio) }
  return { ...node, second: updateRatioAtPath(node.second, path.slice(1), newRatio) }
}

// ── Layout computation ────────────────────────────────────────────────────────

const DIVIDER = 5 // px

export interface LayoutRect {
  sessionId: string
  left: number; top: number; width: number; height: number
}

export interface DividerInfo {
  path: string
  dir: 'h' | 'v'
  left: number; top: number; width: number; height: number
  parentLeft: number; parentTop: number; parentWidth: number; parentHeight: number
}

export function computeLayout(
  node: PaneNode,
  x: number, y: number, w: number, h: number,
  path = '',
): { rects: Map<string, LayoutRect>; dividers: DividerInfo[] } {
  const rects = new Map<string, LayoutRect>()
  const dividers: DividerInfo[] = []

  function traverse(n: PaneNode, nx: number, ny: number, nw: number, nh: number, np: string) {
    if (n.type === 'leaf') {
      rects.set(n.sessionId, { sessionId: n.sessionId, left: nx, top: ny, width: nw, height: nh })
      return
    }
    if (n.dir === 'h') {
      const firstW = nw * n.ratio - DIVIDER / 2
      const secondX = nx + nw * n.ratio + DIVIDER / 2
      const secondW = nw * (1 - n.ratio) - DIVIDER / 2
      dividers.push({
        path: np, dir: 'h',
        left: nx + nw * n.ratio - DIVIDER / 2, top: ny, width: DIVIDER, height: nh,
        parentLeft: nx, parentTop: ny, parentWidth: nw, parentHeight: nh,
      })
      traverse(n.first, nx, ny, firstW, nh, np + 'L')
      traverse(n.second, secondX, ny, secondW, nh, np + 'R')
    } else {
      const firstH = nh * n.ratio - DIVIDER / 2
      const secondY = ny + nh * n.ratio + DIVIDER / 2
      const secondH = nh * (1 - n.ratio) - DIVIDER / 2
      dividers.push({
        path: np, dir: 'v',
        left: nx, top: ny + nh * n.ratio - DIVIDER / 2, width: nw, height: DIVIDER,
        parentLeft: nx, parentTop: ny, parentWidth: nw, parentHeight: nh,
      })
      traverse(n.first, nx, ny, nw, firstH, np + 'L')
      traverse(n.second, nx, secondY, nw, secondH, np + 'R')
    }
  }

  traverse(node, x, y, w, h, path)
  return { rects, dividers }
}

// ── SplitDividers — renders only the drag handles, no terminals ───────────────

export function SplitDividers({
  dividers, containerRef, onRatioChange,
}: {
  dividers: DividerInfo[]
  containerRef: React.RefObject<HTMLDivElement>
  onRatioChange: (path: string, newRatio: number) => void
}) {
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)

  const handleMouseDown = (e: React.MouseEvent, d: DividerInfo) => {
    e.preventDefault()
    document.body.style.cursor = d.dir === 'h' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      if (d.dir === 'h') {
        const relX = ev.clientX - rect.left - d.parentLeft
        onRatioChange(d.path, Math.max(0.1, Math.min(0.9, relX / d.parentWidth)))
      } else {
        const relY = ev.clientY - rect.top - d.parentTop
        onRatioChange(d.path, Math.max(0.1, Math.min(0.9, relY / d.parentHeight)))
      }
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <>
      {dividers.map(d => (
        <div
          key={d.path}
          onMouseDown={e => handleMouseDown(e, d)}
          onMouseEnter={() => setHoveredPath(d.path)}
          onMouseLeave={() => setHoveredPath(null)}
          style={{
            position: 'absolute',
            left: d.left, top: d.top, width: d.width, height: d.height,
            background: hoveredPath === d.path ? '#333' : '#1a1a1a',
            cursor: d.dir === 'h' ? 'col-resize' : 'row-resize',
            zIndex: 10,
            transition: 'background 0.15s',
          }}
        />
      ))}
    </>
  )
}
