import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useUiStore } from '../store/ui'

export function ChoiceDialog() {
  const req = useUiStore((s) => s.choiceRequest)
  const resolve = useUiStore((s) => s.resolveChoice)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const altRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!req) return
    const target =
      req.defaultButton === 'alt' ? altRef.current
      : req.defaultButton === 'cancel' ? cancelRef.current
      : primaryRef.current
    target?.focus()
  }, [req?.id, req?.defaultButton])

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        resolve('cancel')
      }
      // Enter resolves whichever button is focused — handled natively by the button.
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req, resolve])

  if (!req) return null

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55"
      onClick={() => resolve('cancel')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="choice-dialog-title"
    >
      <div
        className="bg-app-750 border border-app-400 rounded-[10px] w-[460px] shadow-[0_16px_48px_rgba(0,0,0,0.8)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="choice-dialog-title" className="text-base font-medium text-neutral-100 mb-2">
          {req.title}
        </div>
        {req.message && <div className="text-sm text-neutral-300 mb-4 leading-snug">{req.message}</div>}
        <div className="flex justify-end gap-2 mt-1">
          <button
            ref={cancelRef}
            onClick={() => resolve('cancel')}
            className="px-3 py-1.5 text-sm rounded bg-app-500 text-neutral-300 hover:bg-app-450 focus:outline-none focus:ring-1 focus:ring-app-350"
          >
            {req.cancelLabel}
          </button>
          <button
            ref={altRef}
            onClick={() => resolve('alt')}
            className={clsx(
              'px-3 py-1.5 text-sm rounded focus:outline-none focus:ring-1',
              req.defaultButton === 'alt'
                ? 'bg-app-450 text-neutral-100 hover:bg-app-400 focus:ring-app-350'
                : 'bg-app-500 text-neutral-300 hover:bg-app-450 focus:ring-app-350',
            )}
          >
            {req.altLabel}
          </button>
          <button
            ref={primaryRef}
            onClick={() => resolve('primary')}
            className={clsx(
              'px-3 py-1.5 text-sm rounded focus:outline-none focus:ring-1',
              req.defaultButton === 'primary'
                ? 'bg-app-450 text-neutral-100 hover:bg-app-400 focus:ring-app-350'
                : 'bg-app-500 text-neutral-300 hover:bg-app-450 focus:ring-app-350',
            )}
          >
            {req.primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
