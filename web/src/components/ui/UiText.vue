<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ depth?: string | number; strong?: boolean; type?: string }>()

const cls = computed(() => {
  const out: string[] = []
  if (props.strong) out.push('font-semibold')
  // depth 3 = muted, 2 = secondary, default = base
  if (String(props.depth) === '3') out.push('text-gray-400 dark:text-dark-400')
  else if (String(props.depth) === '2') out.push('text-gray-500 dark:text-dark-300')
  else out.push('text-gray-700 dark:text-gray-200')
  if (props.type === 'success') out.push('!text-emerald-600 dark:!text-emerald-400')
  if (props.type === 'error') out.push('!text-red-600 dark:!text-red-400')
  if (props.type === 'warning') out.push('!text-amber-600 dark:!text-amber-400')
  return out
})
</script>

<template>
  <span :class="cls"><slot /></span>
</template>
