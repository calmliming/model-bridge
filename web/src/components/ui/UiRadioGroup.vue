<script setup lang="ts">
import { provide, ref, watch, type Ref } from 'vue'

const props = defineProps<{
  value?: string | number
  modelValue?: string | number
  size?: 'small' | 'medium' | 'large'
}>()
const emit = defineEmits<{
  (e: 'update:value', v: string | number): void
  (e: 'update:modelValue', v: string | number): void
}>()

const current = ref<string | number | undefined>(props.value ?? props.modelValue)
watch(
  () => props.value ?? props.modelValue,
  (v) => {
    current.value = v
  },
)

function select(v: string | number) {
  current.value = v
  emit('update:value', v)
  emit('update:modelValue', v)
}

provide<{ current: Ref<string | number | undefined>; select: (v: string | number) => void }>(
  'uiRadioGroup',
  { current, select },
)
</script>

<template>
  <div class="inline-flex flex-wrap items-center gap-2" role="radiogroup">
    <slot />
  </div>
</template>
