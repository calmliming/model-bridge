<script setup lang="ts">
import { computed } from 'vue'
import { useFieldContext } from './fieldContext'

const props = defineProps<{
  id?: string
  name?: string
  value?: number | null
  modelValue?: number | null
  type?: string
  clearable?: boolean
  disabled?: boolean
  ariaLabel?: string
  ariaDescribedby?: string
}>()

const field = useFieldContext()
const resolvedId = computed(() => props.id ?? field?.id)

const emit = defineEmits<{
  (e: 'update:value', v: number | null): void
  (e: 'update:modelValue', v: number | null): void
}>()

const ms = computed(() => props.value ?? props.modelValue ?? null)

// Convert epoch ms <-> "YYYY-MM-DDTHH:mm" in local time for datetime-local input.
const localValue = computed(() => {
  if (ms.value == null) return ''
  const d = new Date(ms.value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
})

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  const next = raw ? new Date(raw).getTime() : null
  emit('update:value', next)
  emit('update:modelValue', next)
}

function clear() {
  emit('update:value', null)
  emit('update:modelValue', null)
}
</script>

<template>
  <div class="relative">
    <input
      class="input pr-9"
      type="datetime-local"
      :id="resolvedId"
      :name="name"
      :aria-label="ariaLabel"
      :aria-labelledby="field?.labelId"
      :aria-describedby="ariaDescribedby"
      :value="localValue"
      :disabled="disabled"
      @input="onInput"
    />
    <button
      v-if="clearable && ms != null"
      type="button"
      class="absolute inset-y-0 right-2.5 flex items-center text-gray-400 hover:text-gray-600"
      @click="clear"
    >
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>
