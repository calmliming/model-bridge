<script setup lang="ts">
import { computed } from 'vue'
import { useFieldContext } from './fieldContext'

const props = withDefaults(
  defineProps<{
    id?: string
    name?: string
    value?: string | null
    modelValue?: string | null
    type?: 'text' | 'textarea' | 'password'
    placeholder?: string
    autocomplete?: string
    ariaLabel?: string
    ariaDescribedby?: string
    required?: boolean
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

const field = useFieldContext()
const resolvedId = computed(() => props.id ?? field?.id)

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
    :id="resolvedId"
    :name="name"
    :value="current"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :aria-label="ariaLabel"
    :aria-describedby="ariaDescribedby"
    :required="required"
    :disabled="disabled"
    :readonly="readonly"
    :rows="minRows"
    @input="onInput"
  />
  <input
    v-else
    class="input"
    :class="error && 'input-error'"
    :id="resolvedId"
    :name="name"
    :type="type"
    :value="current"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :aria-label="ariaLabel"
    :aria-describedby="ariaDescribedby"
    :required="required"
    :disabled="disabled"
    :readonly="readonly"
    @input="onInput"
    @keyup="emit('keyup', $event)"
  />
</template>
