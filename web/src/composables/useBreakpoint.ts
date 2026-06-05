import { onMounted, onUnmounted, ref } from 'vue'

/**
 * Tracks the active Naive-UI-style screen breakpoint.
 * Breakpoints (min-width): s=640, m=1024, l=1280, xl=1536, 2xl=1920.
 */
export type Breakpoint = 'xs' | 's' | 'm' | 'l' | 'xl' | '2xl'

const width = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
let listeners = 0

function onResize() {
  width.value = window.innerWidth
}

export function bpFromWidth(w: number): Breakpoint {
  if (w >= 1920) return '2xl'
  if (w >= 1536) return 'xl'
  if (w >= 1280) return 'l'
  if (w >= 1024) return 'm'
  if (w >= 640) return 's'
  return 'xs'
}

const ORDER: Breakpoint[] = ['xs', 's', 'm', 'l', 'xl', '2xl']

/**
 * Resolves a Naive-style span string ("12 l:4 m:6") against the current breakpoint,
 * picking the value for the largest breakpoint that is <= current.
 */
export function resolveSpan(spanStr: string | number, current: Breakpoint): number {
  if (typeof spanStr === 'number') return spanStr
  const tokens = String(spanStr).trim().split(/\s+/)
  const map: Partial<Record<Breakpoint, number>> = {}
  let base = 1
  for (const tok of tokens) {
    if (tok.includes(':')) {
      const [bp, val] = tok.split(':')
      map[bp as Breakpoint] = Number(val)
    } else {
      base = Number(tok)
    }
  }
  let result = base
  const currentIdx = ORDER.indexOf(current)
  for (let i = 0; i <= currentIdx; i++) {
    const bp = ORDER[i]
    if (map[bp] != null) result = map[bp]!
  }
  return result
}

export function useBreakpoint() {
  onMounted(() => {
    if (listeners === 0) window.addEventListener('resize', onResize)
    listeners++
  })
  onUnmounted(() => {
    listeners--
    if (listeners === 0) window.removeEventListener('resize', onResize)
  })
  return { width }
}
