import { nextTick, watch, type Ref } from 'vue'

const stack: Array<{ root: HTMLElement; restore: HTMLElement | null }> = []
const originalInert = new Map<HTMLElement, boolean>()
let observer: MutationObserver | null = null

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]'))
}

function focusFirst(root: HTMLElement) {
  const body = root.querySelector<HTMLElement>('.modal-body')
  ;(body && focusable(body)[0] || focusable(root)[0] || root).focus({ preventScroll: true })
}

function syncBackground() {
  const current = stack.at(-1)?.root
  for (const child of [...document.body.children]) {
    if (!(child instanceof HTMLElement) || child.hasAttribute('aria-live')) continue
    if (!originalInert.has(child)) originalInert.set(child, child.inert)
    child.inert = current ? child !== current : originalInert.get(child) ?? false
  }
  stack.forEach((entry, index) => { entry.root.style.zIndex = String(1000 + index) })
  document.body.classList.toggle('modal-open', !!current)
}

function onFocus(event: FocusEvent) {
  const root = stack.at(-1)?.root
  if (root && event.target instanceof Node && !root.contains(event.target)) focusFirst(root)
}

function onTab(event: KeyboardEvent) {
  const root = stack.at(-1)?.root
  if (!root || event.key !== 'Tab') return
  const items = focusable(root)
  const first = items[0], last = items.at(-1)
  if (!first) { event.preventDefault(); root.focus(); return }
  if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
    event.preventDefault(); last?.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
    event.preventDefault(); first.focus()
  }
}

export function useModalFocus(show: () => boolean, root: Ref<HTMLElement | null>) {
  watch(show, async (open, _previous, onCleanup) => {
    if (!open) return
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let canceled = false
    let entry: (typeof stack)[number] | undefined
    onCleanup(() => {
      canceled = true
      if (!entry) return
      const index = stack.indexOf(entry)
      if (index >= 0) stack.splice(index, 1)
      syncBackground()
      if (!stack.length) {
        observer?.disconnect(); observer = null
        document.removeEventListener('focusin', onFocus, true)
        document.removeEventListener('keydown', onTab, true)
        for (const [element, inert] of originalInert) element.inert = inert
        originalInert.clear()
      }
      const top = stack.at(-1)?.root
      if (restore?.isConnected && !restore.closest('[inert]') && (!top || top.contains(restore))) restore.focus({ preventScroll: true })
      else if (top) focusFirst(top)
      entry.root.inert = true
    })
    await nextTick()
    if (canceled || !root.value) return
    entry = { root: root.value, restore }
    stack.push(entry)
    if (stack.length === 1) {
      document.addEventListener('focusin', onFocus, true)
      document.addEventListener('keydown', onTab, true)
      observer = new MutationObserver(syncBackground)
      observer.observe(document.body, { childList: true })
    }
    syncBackground()
    focusFirst(root.value)
  }, { immediate: true, flush: 'post' })
  return { isTop: () => stack.at(-1)?.root === root.value }
}
