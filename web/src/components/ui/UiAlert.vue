<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ type?: 'info' | 'success' | 'warning' | 'error'; title?: string }>(),
  { type: 'info' },
)

const theme = computed(() => {
  switch (props.type) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300'
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300'
    case 'error':
      return 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300'
    default:
      return 'border-primary-200 bg-primary-50 text-primary-800 dark:border-primary-900/50 dark:bg-primary-900/20 dark:text-primary-300'
  }
})
</script>

<template>
  <div class="rounded-xl border px-4 py-3 text-sm leading-relaxed" :class="theme">
    <p v-if="title" class="mb-1 font-semibold">{{ title }}</p>
    <slot />
  </div>
</template>
