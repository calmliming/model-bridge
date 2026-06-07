<script setup lang="ts">
// Form is primarily a layout/label container in this app (label-placement="top").
defineProps<{ labelPlacement?: string }>()
</script>

<template>
  <form class="space-y-0" @submit.prevent>
    <slot />
  </form>
</template>
