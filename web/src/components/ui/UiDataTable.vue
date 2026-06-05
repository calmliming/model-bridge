<script setup lang="ts" generic="T extends Record<string, any>">
import { computed } from 'vue'
import type { TableColumn } from './types'

const props = withDefaults(
  defineProps<{
    columns: TableColumn<T>[]
    data: T[]
    loading?: boolean
    rowKey?: (row: T) => string | number
    scrollX?: number
    emptyText?: string
  }>(),
  { emptyText: '暂无数据' },
)

function keyOf(row: T, index: number): string | number {
  return props.rowKey ? props.rowKey(row) : (row.id ?? index)
}

function cellStyle(col: TableColumn<T>) {
  const style: Record<string, string> = {}
  if (col.width != null) style.width = typeof col.width === 'number' ? `${col.width}px` : col.width
  if (col.minWidth != null)
    style.minWidth = typeof col.minWidth === 'number' ? `${col.minWidth}px` : col.minWidth
  if (col.align) style.textAlign = col.align
  return style
}

const tableStyle = computed(() => (props.scrollX ? { minWidth: `${props.scrollX}px` } : {}))
</script>

<template>
  <div class="relative overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-700">
    <table class="data-table" :style="tableStyle">
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key" :style="cellStyle(col)">{{ col.title }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in data" :key="keyOf(row, index)">
          <td v-for="col in columns" :key="col.key" :style="cellStyle(col)">
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
