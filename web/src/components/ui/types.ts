import type { VNodeChild } from 'vue'

/** Column descriptor for UiDataTable. */
export interface TableColumn<Row = Record<string, unknown>> {
  title: string
  key: string
  width?: number | string
  minWidth?: number | string
  fixed?: boolean | 'left'
  align?: 'left' | 'center' | 'right'
  render?: (row: Row, index: number) => VNodeChild
  // Permissive: views may carry extra column props (sorter, ellipsis, fixed,
  // titleAlign, etc.) that this kit ignores. Allowing them avoids excess-property
  // type errors without each view having to drop the fields.
  [key: string]: unknown
}
