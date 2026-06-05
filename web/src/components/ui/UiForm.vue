<script setup lang="ts">
// n-form is primarily a layout/label container in this app (label-placement="top").
defineProps<{ labelPlacement?: string }>()
</script>

<template>
  <form class="space-y-0" @submit.prevent>
    <slot />
  </form>
</template>
