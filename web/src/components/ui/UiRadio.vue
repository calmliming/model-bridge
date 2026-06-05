<script setup lang="ts">
import { computed, inject } from 'vue'

const props = defineProps<{ value: string | number }>()

const group = inject<{ current: { value: string | number | undefined }; select: (v: string | number) => void }>(
  'uiRadioGroup',
)

const active = computed(() => group?.current.value === props.value)
</script>

<template>
  <label class="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
    <span
      class="flex h-4 w-4 items-center justify-center rounded-full border transition-colors"
      :class="active ? 'border-primary-500' : 'border-gray-300 dark:border-dark-500'"
      @click="group?.select(value)"
    >
      <span v-if="active" class="h-2 w-2 rounded-full bg-primary-500" />
    </span>
    <span @click="group?.select(value)"><slot /></span>
  </label>
</template>
