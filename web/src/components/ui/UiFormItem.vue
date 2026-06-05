<script setup lang="ts">
defineProps<{ label?: string; hint?: string; error?: string }>()
</script>

<template>
  <div class="mb-4 last:mb-0">
    <label v-if="label" class="field-label">{{ label }}</label>
    <slot />
    <p v-if="error" class="field-error">{{ error }}</p>
    <p v-else-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>
