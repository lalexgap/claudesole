import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useUiStore } from '../store/ui'

export function ConfirmDialog() {
  const req = useUiStore((s) => s.confirmRequest)
  const resolve = useUiStore((s) => s.resolveConfirm)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!req) return
    // Danger dialogs auto-focus Cancel so an absent-minded Enter doesn't destroy state.
    const target = req.tone === 'danger' ? cancelBtnRef.current : confirmBtnRef.current
    target?.focus()
  }, [req?.id, req?.tone])

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        resolve(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        resolve(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req, resolve])

  if (!req) return null

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55"
      onClick={() => resolve(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="bg-app-750 border border-app-400 rounded-[10px] w-[420px] shadow-[0_16px_48px_rgba(0,0,0,0.8)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="confirm-dialog-title" className="text-base font-medium text-neutral-100 mb-2">
          {req.title}
        </div>
        {req.message && <div className="text-sm text-neutral-300 mb-4 leading-snug">{req.message}</div>}
        <div className="flex justify-end gap-2 mt-1">
          <button
            ref={cancelBtnRef}
            onClick={() => resolve(false)}
            className="px-3 py-1.5 text-sm rounded bg-app-500 text-neutral-300 hover:bg-app-450 focus:outline-none focus:ring-1 focus:ring-app-350"
          >
            {req.cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            onClick={() => resolve(true)}
            className={clsx(
              'px-3 py-1.5 text-sm rounded focus:outline-none focus:ring-1',
              req.tone === 'danger'
                ? 'bg-red-600 text-white hover:bg-red-500 focus:ring-red-400'
                : 'bg-app-450 text-neutral-100 hover:bg-app-400 focus:ring-app-350',
            )}
          >
            {req.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
