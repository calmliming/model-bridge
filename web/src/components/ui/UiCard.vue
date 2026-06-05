<script setup lang="ts">
withDefaults(defineProps<{ title?: string; bordered?: boolean; padding?: boolean }>(), {
  bordered: true,
  padding: true,
})
</script>

<template>
  <div class="card">
    <div v-if="title || $slots.header" class="card-header">
      <h3 v-if="title" class="text-base font-semibold text-gray-900 dark:text-white">{{ title }}</h3>
      <slot name="header" />
      <slot name="header-extra" />
    </div>
    <div :class="padding ? 'card-body' : ''">
      <slot />
    </div>
    <div v-if="$slots.footer" class="border-t border-gray-100 px-5 py-4 dark:border-dark-700">
      <slot name="footer" />
    </div>
  </div>
</template>
