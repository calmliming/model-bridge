<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  value?: boolean
  modelValue?: boolean
  size?: 'small' | 'medium'
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:value', value: boolean): void
  (e: 'update:modelValue', value: boolean): void
  (e: 'updateValue', value: boolean): void
}>()

const current = computed(() => props.value ?? props.modelValue ?? false)

function toggle() {
  if (props.disabled) return
  const next = !current.value
  emit('update:value', next)
  emit('update:modelValue', next)
  // Naive render-function usage passes `onUpdateValue`; mirror it.
  emit('updateValue', next)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="current"
    :disabled="disabled"
    class="relative inline-flex flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      size === 'small' ? 'h-5 w-9' : 'h-6 w-11',
      current ? 'bg-primary-500' : 'bg-gray-300 dark:bg-dark-600',
    ]"
    @click="toggle"
  >
    <span
      class="pointer-events-none inline-block transform rounded-full bg-white shadow ring-0 transition duration-200"
      :class="[
        size === 'small' ? 'h-4 w-4' : 'h-5 w-5',
        current ? (size === 'small' ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0',
      ]"
    />
  </button>
</template>
