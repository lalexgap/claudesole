import clsx from 'clsx'
import { useUiStore, type ToastTone } from '../store/ui'

const TONE_BORDER: Record<ToastTone, string> = {
  info: 'border-l-blue-500',
  success: 'border-l-green-500',
  warn: 'border-l-yellow-500',
  error: 'border-l-red-500',
}

const TONE_ICON_COLOR: Record<ToastTone, string> = {
  info: 'text-blue-400',
  success: 'text-green-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
}

const TONE_GLYPH: Record<ToastTone, string> = {
  info: 'i',
  success: '✓',
  warn: '!',
  error: '×',
}

export function ToastStack() {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto max-w-sm bg-app-750 border border-app-400 border-l-4',
            'rounded-md px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.6)] flex items-start gap-2',
            TONE_BORDER[t.tone],
          )}
        >
          <span className={clsx('text-sm font-semibold leading-5 w-3 text-center shrink-0', TONE_ICON_COLOR[t.tone])}>
            {TONE_GLYPH[t.tone]}
          </span>
          <div className="flex-1 text-sm text-neutral-200 leading-5 break-words">{t.message}</div>
          {t.action && (
            <button
              onClick={() => {
                t.action!.onClick()
                dismiss(t.id)
              }}
              className="text-xs text-blue-400 hover:text-blue-300 underline shrink-0 self-center"
            >
              {t.action.label}
            </button>
          )}
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="text-neutral-500 hover:text-neutral-300 text-sm leading-none shrink-0 px-1 self-start"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
