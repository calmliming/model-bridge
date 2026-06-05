<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue'

defineProps<{ title?: string; description?: string }>()

const ctx = inject<{ vertical: boolean; current: Ref<number>; nextIndex: () => number }>('uiSteps')

const index = ref(ctx ? ctx.nextIndex() : 1)
const done = computed(() => (ctx ? index.value <= ctx.current.value : false))
</script>

<template>
  <div class="flex gap-3" :class="ctx?.vertical ? 'pb-6 last:pb-0' : ''">
    <div class="flex flex-col items-center">
      <span
        class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors"
        :class="
          done
            ? 'border-primary-500 bg-primary-500 text-white'
            : 'border-gray-300 bg-white text-gray-400 dark:border-dark-500 dark:bg-dark-800'
        "
      >
        <svg v-if="done" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
        <template v-else>{{ index }}</template>
      </span>
      <span
        v-if="ctx?.vertical"
        class="mt-1 w-0.5 flex-1"
        :class="done ? 'bg-primary-500' : 'bg-gray-200 dark:bg-dark-600'"
      />
    </div>
    <div class="pb-1 pt-1">
      <p class="text-sm font-semibold text-gray-900 dark:text-white">{{ title }}</p>
      <p v-if="description" class="mt-1 text-sm text-gray-500 dark:text-dark-400">{{ description }}</p>
    </div>
  </div>
</template>
