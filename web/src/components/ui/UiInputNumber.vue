<script setup lang="ts">
import { computed } from 'vue'
import { useFieldContext } from './fieldContext'

const props = withDefaults(
  defineProps<{
    id?: string
    name?: string
    value?: number | null
    modelValue?: number | null
    placeholder?: string
    ariaLabel?: string
    ariaDescribedby?: string
    min?: number
    max?: number
    step?: number
    disabled?: boolean
  }>(),
  { step: 1 },
)

const field = useFieldContext()
const resolvedId = computed(() => props.id ?? field?.id)

const emit = defineEmits<{
  (e: 'update:value', value: number | null): void
  (e: 'update:modelValue', value: number | null): void
  (e: 'updateValue', value: number | null): void
}>()

const current = computed(() => props.value ?? props.modelValue ?? null)

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  const v = raw === '' ? null : Number(raw)
  const next = v != null && Number.isNaN(v) ? null : v
  emit('update:value', next)
  emit('update:modelValue', next)
  emit('updateValue', next)
}
</script>

<template>
  <input
    class="input"
    type="number"
    :id="resolvedId"
    :name="name"
    :aria-label="ariaLabel"
    :aria-labelledby="field?.labelId"
    :aria-describedby="ariaDescribedby"
    :value="current ?? ''"
    :placeholder="placeholder"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    @input="onInput"
  />
</template>
