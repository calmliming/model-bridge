<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    value?: string | null
    modelValue?: string | null
    type?: 'text' | 'textarea' | 'password'
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    error?: boolean
    rows?: number
    autosize?: { minRows?: number; maxRows?: number } | boolean
  }>(),
  {
    type: 'text',
    rows: 3,
  },
)

const emit = defineEmits<{
  (e: 'update:value', value: string): void
  (e: 'update:modelValue', value: string): void
  (e: 'keyup', ev: KeyboardEvent): void
}>()

// Support both v-model:value and standard v-model.
const current = computed(() => props.value ?? props.modelValue ?? '')

function onInput(e: Event) {
  const v = (e.target as HTMLInputElement | HTMLTextAreaElement).value
  emit('update:value', v)
  emit('update:modelValue', v)
}

const minRows = computed(() =>
  typeof props.autosize === 'object' ? (props.autosize.minRows ?? props.rows) : props.rows,
)
</script>

<template>
  <textarea
    v-if="type === 'textarea'"
    class="input resize-y"
    :class="error && 'input-error'"
    :value="current"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :rows="minRows"
    @input="onInput"
  />
  <input
    v-else
    class="input"
    :class="error && 'input-error'"
    :type="type"
    :value="current"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    @input="onInput"
    @keyup="emit('keyup', $event)"
  />
</template>
