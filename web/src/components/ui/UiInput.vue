<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFieldContext } from './fieldContext'

defineOptions({ inheritAttrs: false })
const passwordVisible = ref(false)

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
const invalid = computed(() => props.error || field?.invalid.value || false)
const describedBy = computed(() => props.ariaDescribedby ?? field?.descriptionId.value)

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
    v-bind="$attrs"
    class="input resize-y"
    :class="invalid && 'input-error'"
    :id="resolvedId"
    :name="name"
    :value="current"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :aria-label="ariaLabel"
    :aria-describedby="describedBy"
    :aria-invalid="invalid || undefined"
    :required="required"
    :disabled="disabled"
    :readonly="readonly"
    :rows="minRows"
    @input="onInput"
  />
  <div v-else-if="type === 'password'" class="relative min-w-0">
    <input v-bind="$attrs" class="input !pr-14" :class="invalid && 'input-error'" :id="resolvedId" :name="name"
      :type="passwordVisible ? 'text' : 'password'" :value="current" :placeholder="placeholder" :autocomplete="autocomplete"
      :aria-label="ariaLabel" :aria-describedby="describedBy" :aria-invalid="invalid || undefined"
      :required="required" :disabled="disabled" :readonly="readonly" @input="onInput" @keyup="emit('keyup', $event)" />
    <button type="button" class="absolute inset-y-0 right-1 rounded-lg px-2 text-xs text-gray-500 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      :disabled="disabled" :aria-label="passwordVisible ? '隐藏密码' : '显示密码'" :aria-pressed="passwordVisible" @click="passwordVisible = !passwordVisible">{{ passwordVisible ? '隐藏' : '显示' }}</button>
  </div>
  <input
    v-else
    v-bind="$attrs"
    class="input"
    :class="invalid && 'input-error'"
    :id="resolvedId"
    :name="name"
    :type="type"
    :value="current"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :aria-label="ariaLabel"
    :aria-describedby="describedBy"
    :aria-invalid="invalid || undefined"
    :required="required"
    :disabled="disabled"
    :readonly="readonly"
    @input="onInput"
    @keyup="emit('keyup', $event)"
  />
</template>
