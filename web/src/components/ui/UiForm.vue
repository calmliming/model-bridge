<script setup lang="ts">
// Form is primarily a layout/label container in this app (label-placement="top").
defineProps<{ labelPlacement?: string; novalidate?: boolean }>()

const emit = defineEmits<{ (e: 'submit', event: SubmitEvent): void }>()

function onSubmit(event: SubmitEvent) {
  event.preventDefault()
  emit('submit', event)
}
</script>

<template>
  <form class="space-y-0" :novalidate="novalidate" @submit="onSubmit">
    <slot />
  </form>
</template>
