import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { bracketMatching, indentOnInput, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { oneDark } from '@codemirror/theme-one-dark'
import { useSessionsStore } from '../store/sessions'

// Per-session imperative handle for callers (e.g. App.tsx's dirty-close prompt)
// to trigger a save without reaching into CodeMirror internals.
const editorHandles = new Map<string, { save: () => Promise<void> }>()
export function saveEditor(sessionId: string): Promise<void> {
  return editorHandles.get(sessionId)?.save() ?? Promise.resolve()
}
export function hasEditor(sessionId: string): boolean {
  return editorHandles.has(sessionId)
}

interface Props {
  sessionId: string
  filePath: string
  isActive: boolean
}

function languageFor(filePath: string) {
  const basename = filePath.split('/').pop() ?? ''
  // Ruby ships extensionless filenames more than most languages — match by
  // basename before falling through to extension dispatch.
  if (/^(Gemfile|Rakefile|Guardfile|Capfile|Berksfile|Vagrantfile|Podfile|Brewfile|Thorfile|config\.ru)$/i.test(basename)) {
    return StreamLanguage.define(ruby)
  }
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true, jsx: ext === 'tsx' })
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: ext === 'jsx' })
    case 'json':
      return json()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'html':
    case 'htm':
      return html()
    case 'md':
    case 'markdown':
      return markdown()
    case 'py':
      return python()
    case 'yml':
    case 'yaml':
      return yaml()
    case 'sh':
    case 'bash':
    case 'zsh':
      return StreamLanguage.define(shell)
    case 'rb':
    case 'rake':
    case 'gemspec':
    case 'ru':
    case 'erb':
      return StreamLanguage.define(ruby)
    default:
      return []
  }
}

export function EditorView_({ sessionId, filePath, isActive }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageRef = useRef(new Compartment())
  const initialContentRef = useRef<string>('')
  const lastMtimeRef = useRef<number>(0)
  const setDirty = useSessionsStore((s) => s.setDirty)
  const isDirtyRef = useRef<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [externallyChanged, setExternallyChanged] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.electronAPI.readFile(filePath)
      .then(({ content, mtimeMs }) => {
        lastMtimeRef.current = mtimeMs
        if (cancelled || !hostRef.current) return
        initialContentRef.current = content

        const save = (): Promise<void> => {
          const view = viewRef.current
          if (!view) return Promise.resolve()
          const text = view.state.doc.toString()
          return window.electronAPI.writeFile(filePath, text)
            .then((res) => {
              initialContentRef.current = text
              lastMtimeRef.current = res.mtimeMs
              isDirtyRef.current = false
              setDirty(sessionId, false)
              setExternallyChanged(false)
            })
            .catch((err) => { setError(String(err?.message ?? err)); throw err })
        }
        editorHandles.set(sessionId, { save })
        const saveCommand = () => { void save(); return true }

        const state = EditorState.create({
          doc: content,
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            drawSelection(),
            history(),
            foldGutter(),
            bracketMatching(),
            indentOnInput(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            highlightSelectionMatches(),
            highlightActiveLine(),
            languageRef.current.of(languageFor(filePath)),
            oneDark,
            keymap.of([
              { key: 'Mod-s', preventDefault: true, run: saveCommand },
              indentWithTab,
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              ...foldKeymap,
            ]),
            EditorView.theme({
              '&': { height: '100%', backgroundColor: '#1a1a1a' },
              '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' },
              '.cm-gutters': { backgroundColor: '#141414', borderRight: '1px solid #222' },
              '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
              '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
            }),
            EditorView.updateListener.of((v) => {
              if (!v.docChanged) return
              const dirty = v.state.doc.toString() !== initialContentRef.current
              isDirtyRef.current = dirty
              setDirty(sessionId, dirty)
            }),
          ],
        })

        viewRef.current = new EditorView({ state, parent: hostRef.current })
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(String(err?.message ?? err))
        setLoading(false)
      })

    return () => {
      cancelled = true
      viewRef.current?.destroy()
      viewRef.current = null
      editorHandles.delete(sessionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, sessionId])

  useEffect(() => {
    if (!isActive) return
    const id = requestAnimationFrame(() => viewRef.current?.focus())

    // Re-stat the file on focus. If the on-disk mtime advanced since we last
    // loaded it and the buffer is clean, silently reload. If the buffer is
    // dirty, surface a banner so the user can pick.
    window.electronAPI.fileExists(filePath).then(r => {
      if (!r.exists || !r.isFile) return
      if (r.mtimeMs <= lastMtimeRef.current) return
      if (isDirtyRef.current) { setExternallyChanged(true); return }
      void reloadFromDisk()
    }).catch(() => {})

    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  const reloadFromDisk = async () => {
    try {
      const { content, mtimeMs } = await window.electronAPI.readFile(filePath)
      const view = viewRef.current
      if (!view) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
      initialContentRef.current = content
      lastMtimeRef.current = mtimeMs
      isDirtyRef.current = false
      setDirty(sessionId, false)
      setExternallyChanged(false)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    }
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-app-800 text-[#888] text-sm p-6 text-center">
        <div>
          <div className="text-red-400 mb-2">Couldn't open file</div>
          <div className="font-mono text-xs">{error}</div>
          <div className="text-[#555] mt-2">{filePath}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full bg-app-800 relative">
      <div ref={hostRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-[#555] text-xs">Loading…</div>
      )}
      {externallyChanged && (
        <div className="absolute top-2 right-2 bg-amber-400/15 border border-amber-400/40 text-amber-200 text-xs rounded px-3 py-2 flex items-center gap-3 shadow-lg z-10">
          <span>File changed on disk.</span>
          <button
            onClick={() => void reloadFromDisk()}
            className="bg-amber-400/30 hover:bg-amber-400/50 text-amber-100 px-2 py-0.5 rounded text-[11px]"
          >
            Reload
          </button>
          <button
            onClick={() => setExternallyChanged(false)}
            className="text-amber-200/70 hover:text-amber-100 text-[11px]"
          >
            Keep mine
          </button>
        </div>
      )}
    </div>
  )
}

// Re-export under the more natural name. The internal symbol is suffixed
// because CodeMirror's own `EditorView` is imported above.
export { EditorView_ as Editor }
