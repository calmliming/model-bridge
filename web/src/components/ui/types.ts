import type { VNodeChild } from 'vue'

/** Column descriptor for UiDataTable, mirroring the Naive UI column API used in views. */
export interface TableColumn<Row = Record<string, unknown>> {
  title: string
  key: string
  width?: number | string
  minWidth?: number | string
  align?: 'left' | 'center' | 'right'
  render?: (row: Row, index: number) => VNodeChild
  // Permissive: views carry extra Naive column props (sorter, ellipsis, fixed,
  // titleAlign, …) that this kit ignores. Allowing them avoids excess-property
  // type errors without each view having to drop the fields.
  [key: string]: unknown
}
