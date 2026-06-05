/**
 * Compatibility shim that maps the small slice of the Naive UI API this app used
 * onto the Tailwind-based UI kit in `src/components/ui`. The `naive-ui` import
 * specifier is aliased to this module (see vite.config.ts / tsconfig.json), so
 * existing `import { NButton, useMessage } from 'naive-ui'` lines keep working
 * without the real dependency.
 */
export { useMessage } from '../composables/useMessage'
export { useDialog } from '../composables/useDialog'

export { default as NButton } from '../components/ui/UiButton.vue'
export { default as NInputNumber } from '../components/ui/UiInputNumber.vue'
export { default as NSelect } from '../components/ui/UiSelect.vue'
export { default as NSpace } from '../components/ui/UiSpace.vue'
export { default as NSwitch } from '../components/ui/UiSwitch.vue'
export { default as NTag } from '../components/ui/UiTag.vue'
export { default as NTooltip } from '../components/ui/UiTooltip.vue'

import type { TableColumn } from '../components/ui/types'

/** Mirrors Naive's `DataTableColumns<T>` — an array of column descriptors. */
export type DataTableColumns<T = Record<string, unknown>> = TableColumn<T>[]
