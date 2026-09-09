<script setup lang="ts">
withDefaults(defineProps<{ size?: number; alt?: string }>(), {
  size: 40,
  alt: '',
})
</script>

<template>
  <img
    class="brand-logo"
    src="/brand/model-bridge-mark-192-v1.png"
    :alt="alt"
    :width="size"
    :height="size"
    :style="{ width: `${size}px`, height: `${size}px` }"
    draggable="false"
  />
</template>

<style scoped>
.brand-logo {
  display: block;
  flex-shrink: 0;
  object-fit: contain;
}
</style>
