import { ref, watch } from 'vue'

/** Persists a desktop sidebar's collapsed state without affecting mobile drawers. */
export function useCollapsibleSidebar(storageKey: string) {
  const collapsed = ref(false)

  if (typeof window !== 'undefined') {
    try {
      collapsed.value = window.localStorage.getItem(storageKey) === 'true'
    } catch {
      // Restricted browser contexts can disable localStorage; in-memory state still works.
    }
  }

  watch(collapsed, (value) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(storageKey, String(value))
      } catch {
        // Keep the interaction available even when persistence is unavailable.
      }
    }
  })

  function toggle(): void {
    collapsed.value = !collapsed.value
  }

  return { collapsed, toggle }
}
