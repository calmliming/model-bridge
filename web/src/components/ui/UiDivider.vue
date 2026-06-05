<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <div class="my-4 flex items-center gap-3">
    <span class="h-px flex-1 bg-gray-200 dark:bg-dark-700" />
    <span v-if="$slots.default || title" class="text-xs font-medium text-gray-400 dark:text-dark-400">
      <slot>{{ title }}</slot>
    </span>
    <span v-if="$slots.default || title" class="h-px flex-1 bg-gray-200 dark:bg-dark-700" />
  </div>
</template>
