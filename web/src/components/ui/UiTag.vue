<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    type?: 'default' | 'info' | 'success' | 'warning' | 'error' | 'primary'
    size?: 'small' | 'medium'
  }>(),
  { type: 'default' },
)

const cls = computed(() => {
  switch (props.type) {
    case 'info':
      return 'badge-info'
    case 'success':
      return 'badge-success'
    case 'warning':
      return 'badge-warning'
    case 'error':
      return 'badge-danger'
    case 'primary':
      return 'badge-primary'
    default:
      return 'badge-gray'
  }
})
</script>

<template>
  <span class="badge" :class="cls">
    <slot />
  </span>
</template>
