<script setup lang="ts" generic="T extends Record<string, any>">
import { computed } from 'vue'
import type { TableColumn } from './types'

const props = withDefaults(
  defineProps<{
    columns: TableColumn<T>[]
    data: T[]
    loading?: boolean
    selectable?: boolean
    checkedRowKeys?: Array<string | number>
    rowCheckable?: (row: T) => boolean
    rowKey?: (row: T) => string | number
    scrollX?: number
    emptyText?: string
  }>(),
  { emptyText: '暂无数据' },
)

const emit = defineEmits<{
  (e: 'update:checkedRowKeys', keys: Array<string | number>): void
}>()

function keyOf(row: T, index: number): string | number {
  return props.rowKey ? props.rowKey(row) : (row.id ?? index)
}

function canCheck(row: T): boolean {
  return props.rowCheckable ? props.rowCheckable(row) : true
}

const checkedSet = computed(() => new Set(props.checkedRowKeys ?? []))
const checkableRows = computed(() =>
  props.data
    .map((row, index) => ({ row, index, key: keyOf(row, index) }))
    .filter(({ row }) => canCheck(row)),
)
const allRowsChecked = computed(() =>
  checkableRows.value.length > 0 && checkableRows.value.every(({ key }) => checkedSet.value.has(key)),
)
const someRowsChecked = computed(() => checkableRows.value.some(({ key }) => checkedSet.value.has(key)))

function setChecked(key: string | number, checked: boolean) {
  const next = new Set(checkedSet.value)
  if (checked) next.add(key)
  else next.delete(key)
  emit('update:checkedRowKeys', [...next])
}

function toggleAll(checked: boolean) {
  const next = new Set(checkedSet.value)
  for (const { key } of checkableRows.value) {
    if (checked) next.add(key)
    else next.delete(key)
  }
  emit('update:checkedRowKeys', [...next])
}

function checkedFromEvent(event: Event): boolean {
  return (event.target as HTMLInputElement).checked
}

function isFixedLeft(col: TableColumn<T>): boolean {
  return col.fixed === true || col.fixed === 'left'
}

function isFixedRight(col: TableColumn<T>): boolean {
  return col.fixed === 'right'
}

function numericColumnWidth(col: TableColumn<T>): number {
  const raw = col.width ?? col.minWidth
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && /^\d+(?:\.\d+)?px$/.test(raw)) return Number.parseFloat(raw)
  return 0
}

function fixedLeftOffset(index: number): number {
  let offset = props.selectable ? 42 : 0
  for (let i = 0; i < index; i += 1) {
    const previous = props.columns[i]
    if (previous && isFixedLeft(previous)) offset += numericColumnWidth(previous)
  }
  return offset
}

function fixedRightOffset(index: number): number {
  let offset = 0
  for (let i = index + 1; i < props.columns.length; i += 1) {
    const next = props.columns[i]
    if (next && isFixedRight(next)) offset += numericColumnWidth(next)
  }
  return offset
}

function cellStyle(col: TableColumn<T>, index: number, section: 'head' | 'body') {
  const style: Record<string, string> = {}
  if (col.width != null) style.width = typeof col.width === 'number' ? `${col.width}px` : col.width
  if (col.minWidth != null)
    style.minWidth = typeof col.minWidth === 'number' ? `${col.minWidth}px` : col.minWidth
  if (col.align) style.textAlign = col.align
  if (isFixedLeft(col)) {
    style.position = 'sticky'
    style.left = `${fixedLeftOffset(index)}px`
    style.zIndex = section === 'head' ? '4' : '3'
  }
  if (isFixedRight(col)) {
    style.position = 'sticky'
    style.right = `${fixedRightOffset(index)}px`
    style.zIndex = section === 'head' ? '4' : '3'
  }
  return style
}

function cellClass(col: TableColumn<T>) {
  if (isFixedLeft(col)) return 'is-fixed-left'
  if (isFixedRight(col)) return 'is-fixed-right'
  return undefined
}

const tableStyle = computed(() => (props.scrollX ? { minWidth: `${props.scrollX}px` } : {}))
</script>

<template>
  <div class="relative overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-700">
    <table class="data-table" :style="tableStyle">
      <thead>
        <tr>
          <th v-if="selectable" class="selection-cell">
            <input
              type="checkbox"
              class="selection-checkbox"
              :checked="allRowsChecked"
              :indeterminate="someRowsChecked && !allRowsChecked"
              :disabled="!checkableRows.length"
              :aria-checked="someRowsChecked && !allRowsChecked ? 'mixed' : allRowsChecked"
              aria-label="选择当前表格账户"
              @change="toggleAll(checkedFromEvent($event))"
            />
          </th>
          <th
            v-for="(col, colIndex) in columns"
            :key="col.key"
            :class="cellClass(col)"
            :style="cellStyle(col, colIndex, 'head')"
          >
            {{ col.title }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in data" :key="keyOf(row, index)">
          <td v-if="selectable" class="selection-cell">
            <input
              type="checkbox"
              class="selection-checkbox"
              :checked="checkedSet.has(keyOf(row, index))"
              :disabled="!canCheck(row)"
              :aria-label="`选择 ${row.name ?? keyOf(row, index)}`"
              @change="setChecked(keyOf(row, index), checkedFromEvent($event))"
            />
          </td>
          <td
            v-for="(col, colIndex) in columns"
            :key="col.key"
            :class="cellClass(col)"
            :style="cellStyle(col, colIndex, 'body')"
          >
            <component :is="() => col.render!(row, index)" v-if="col.render" />
            <template v-else>{{ row[col.key] ?? '—' }}</template>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="!data.length && !loading" class="empty-state">
      <p class="empty-state-desc">{{ emptyText }}</p>
    </div>

    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm dark:bg-dark-900/60"
    >
      <span class="spinner h-7 w-7 text-primary-500" />
    </div>
  </div>
</template>

<style scoped>
.selection-cell {
  width: 42px;
  min-width: 42px;
  text-align: center;
}

thead .selection-cell {
  position: sticky;
  left: 0;
  z-index: 5;
  background: #f9fafb;
  box-shadow: 8px 0 12px -12px rgba(15, 23, 42, 0.45);
}

tbody .selection-cell {
  position: sticky;
  left: 0;
  z-index: 4;
  background: #fff;
  box-shadow: 8px 0 12px -12px rgba(15, 23, 42, 0.35);
}

tbody tr:hover .selection-cell {
  background: #f9fafb;
}

:global(.dark) thead .selection-cell {
  background: #1e293b;
}

:global(.dark) tbody .selection-cell {
  background: #0f172a;
}

:global(.dark) tbody tr:hover .selection-cell {
  background: #1e293b;
}

.selection-checkbox {
  width: 15px;
  height: 15px;
  border-radius: 4px;
  cursor: pointer;
  vertical-align: middle;
  accent-color: #2563eb;
}

.selection-checkbox:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
