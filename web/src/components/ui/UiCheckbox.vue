<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ checked?: boolean; modelValue?: boolean; disabled?: boolean }>()
const emit = defineEmits<{
  (e: 'update:checked', v: boolean): void
  (e: 'update:modelValue', v: boolean): void
}>()

const current = computed(() => props.checked ?? props.modelValue ?? false)

function toggle() {
  if (props.disabled) return
  emit('update:checked', !current.value)
  emit('update:modelValue', !current.value)
}
</script>

<template>
  <label class="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
    <span
      class="flex h-4 w-4 items-center justify-center rounded border transition-colors"
      :class="
        current
          ? 'border-primary-500 bg-primary-500 text-white'
          : 'border-gray-300 bg-white dark:border-dark-500 dark:bg-dark-800'
      "
      @click="toggle"
    >
      <svg v-if="current" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
        <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    </span>
    <span @click="toggle"><slot /></span>
  </label>
</template>
