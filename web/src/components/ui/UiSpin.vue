<script setup lang="ts">
defineProps<{ show?: boolean }>()
</script>

<template>
  <div class="relative">
    <slot />
    <div
      v-if="show"
      class="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60 backdrop-blur-sm dark:bg-dark-900/60"
    >
      <span class="spinner h-7 w-7 text-primary-500" />
    </div>
  </div>
</template>
