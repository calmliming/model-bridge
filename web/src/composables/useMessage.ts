import { reactive } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  type: ToastType
  content: string
  duration: number
}

let seq = 0

const state = reactive<{ toasts: ToastItem[] }>({ toasts: [] })

export const toastState = state

function push(type: ToastType, content: string, duration = 3200): void {
  const id = ++seq
  state.toasts.push({ id, type, content, duration })
  if (duration > 0) {
    window.setTimeout(() => remove(id), duration)
  }
}

export function remove(id: number): void {
  const idx = state.toasts.findIndex((t) => t.id === id)
  if (idx !== -1) state.toasts.splice(idx, 1)
}

/** Mirrors Naive UI's `useMessage()` API surface used across the app. */
export function useMessage() {
  return {
    success: (content: string, duration?: number) => push('success', content, duration),
    error: (content: string, duration?: number) => push('error', content, duration),
    warning: (content: string, duration?: number) => push('warning', content, duration),
    info: (content: string, duration?: number) => push('info', content, duration),
  }
}
