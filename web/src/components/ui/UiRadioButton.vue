<script setup lang="ts">
import { computed, inject } from 'vue'

const props = defineProps<{ value: string | number }>()

const group = inject<{ current: { value: string | number | undefined }; select: (v: string | number) => void }>(
  'uiRadioGroup',
)

const active = computed(() => group?.current.value === props.value)
</script>

<template>
  <button
    type="button"
    class="rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-all"
    :class="
      active
        ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-300'
        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-dark-600 dark:bg-dark-800 dark:text-gray-300 dark:hover:bg-dark-700'
    "
    @click="group?.select(value)"
  >
    <slot />
  </button>
</template>
