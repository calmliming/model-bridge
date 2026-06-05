import { reactive, type VNodeChild } from 'vue'

export interface DialogOptions {
  title?: string
  /** Either plain text or a render function (mirrors Naive's content slot). */
  content?: string | (() => VNodeChild)
  positiveText?: string
  negativeText?: string
  type?: 'warning' | 'error' | 'info' | 'success'
  onPositiveClick?: () => void | Promise<void>
  onNegativeClick?: () => void
}

interface DialogState extends DialogOptions {
  id: number
  show: boolean
  loading: boolean
}

let seq = 0

const state = reactive<{ dialogs: DialogState[] }>({ dialogs: [] })

export const dialogState = state

function open(type: NonNullable<DialogOptions['type']>, opts: DialogOptions): void {
  state.dialogs.push({
    ...opts,
    id: ++seq,
    type,
    show: true,
    loading: false,
  })
}

export function dismiss(id: number): void {
  const idx = state.dialogs.findIndex((d) => d.id === id)
  if (idx !== -1) state.dialogs.splice(idx, 1)
}

export async function confirm(id: number): Promise<void> {
  const d = state.dialogs.find((x) => x.id === id)
  if (!d) return
  if (d.onPositiveClick) {
    d.loading = true
    try {
      await d.onPositiveClick()
    } finally {
      d.loading = false
    }
  }
  dismiss(id)
}

export function cancel(id: number): void {
  const d = state.dialogs.find((x) => x.id === id)
  d?.onNegativeClick?.()
  dismiss(id)
}

/** Mirrors Naive UI's `useDialog()` API surface used across the app. */
export function useDialog() {
  return {
    warning: (opts: DialogOptions) => open('warning', opts),
    error: (opts: DialogOptions) => open('error', opts),
    info: (opts: DialogOptions) => open('info', opts),
    success: (opts: DialogOptions) => open('success', opts),
  }
}
