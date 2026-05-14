import { create } from 'zustand'
import { nanoid } from 'nanoid'

export type ToastTone = 'info' | 'success' | 'warn' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  tone: ToastTone
  message: string
  action?: ToastAction
  durationMs: number
}

export interface ConfirmRequest {
  id: string
  title: string
  message?: string
  confirmLabel: string
  cancelLabel: string
  tone: 'default' | 'danger'
}

export type ChoiceResult = 'primary' | 'alt' | 'cancel'

export interface ChoiceRequest {
  id: string
  title: string
  message?: string
  primaryLabel: string
  altLabel: string
  cancelLabel: string
  // The button that should look primary/highlighted. `alt` is useful when the
  // safe action isn't the most likely one (e.g. "Discard" rather than "Save").
  defaultButton: 'primary' | 'alt' | 'cancel'
}

interface PushToastInput {
  tone?: ToastTone
  message: string
  action?: ToastAction
  durationMs?: number
}

interface RequestConfirmInput {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

interface RequestChoiceInput {
  title: string
  message?: string
  primaryLabel: string
  altLabel: string
  cancelLabel?: string
  defaultButton?: 'primary' | 'alt' | 'cancel'
}

interface UiState {
  toasts: Toast[]
  confirmRequest: ConfirmRequest | null
  choiceRequest: ChoiceRequest | null
  pushToast: (input: PushToastInput) => string
  dismissToast: (id: string) => void
  requestConfirm: (input: RequestConfirmInput) => Promise<boolean>
  resolveConfirm: (ok: boolean) => void
  requestChoice: (input: RequestChoiceInput) => Promise<ChoiceResult>
  resolveChoice: (result: ChoiceResult) => void
}

let pendingResolver: ((ok: boolean) => void) | null = null
let pendingChoiceResolver: ((result: ChoiceResult) => void) | null = null

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  confirmRequest: null,
  choiceRequest: null,

  pushToast: ({ tone = 'info', message, action, durationMs }) => {
    const id = nanoid()
    const dur = durationMs ?? (action ? 8000 : 4000)
    setTimeout(() => get().dismissToast(id), dur)
    set((state) => ({ toasts: [...state.toasts, { id, tone, message, action, durationMs: dur }] }))
    return id
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  requestConfirm: (input) => {
    // Replacing a pending request resolves the old one as cancelled so callers
    // never hang waiting for a dialog the user can no longer see.
    if (pendingResolver) {
      pendingResolver(false)
      pendingResolver = null
    }
    return new Promise<boolean>((resolve) => {
      pendingResolver = resolve
      set({
        confirmRequest: {
          id: nanoid(),
          title: input.title,
          message: input.message,
          confirmLabel: input.confirmLabel ?? 'OK',
          cancelLabel: input.cancelLabel ?? 'Cancel',
          tone: input.tone ?? 'default',
        },
      })
    })
  },

  resolveConfirm: (ok) => {
    if (pendingResolver) {
      pendingResolver(ok)
      pendingResolver = null
    }
    set({ confirmRequest: null })
  },

  requestChoice: (input) => {
    if (pendingChoiceResolver) {
      pendingChoiceResolver('cancel')
      pendingChoiceResolver = null
    }
    return new Promise<ChoiceResult>((resolve) => {
      pendingChoiceResolver = resolve
      set({
        choiceRequest: {
          id: nanoid(),
          title: input.title,
          message: input.message,
          primaryLabel: input.primaryLabel,
          altLabel: input.altLabel,
          cancelLabel: input.cancelLabel ?? 'Cancel',
          defaultButton: input.defaultButton ?? 'primary',
        },
      })
    })
  },

  resolveChoice: (result) => {
    if (pendingChoiceResolver) {
      pendingChoiceResolver(result)
      pendingChoiceResolver = null
    }
    set({ choiceRequest: null })
  },
}))

export const toast = {
  info: (message: string, action?: ToastAction) =>
    useUiStore.getState().pushToast({ tone: 'info', message, action }),
  success: (message: string, action?: ToastAction) =>
    useUiStore.getState().pushToast({ tone: 'success', message, action }),
  warn: (message: string, action?: ToastAction) =>
    useUiStore.getState().pushToast({ tone: 'warn', message, action }),
  error: (message: string, action?: ToastAction) =>
    useUiStore.getState().pushToast({ tone: 'error', message, action }),
}

export const confirm = (input: RequestConfirmInput) =>
  useUiStore.getState().requestConfirm(input)

export const choose = (input: RequestChoiceInput) =>
  useUiStore.getState().requestChoice(input)
