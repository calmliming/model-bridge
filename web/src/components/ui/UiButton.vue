<script setup lang="ts">
import { computed } from 'vue'

type ButtonType = 'default' | 'primary' | 'success' | 'error' | 'warning'
type ButtonSize = 'tiny' | 'small' | 'medium' | 'large'

const props = withDefaults(
  defineProps<{
    type?: ButtonType
    size?: ButtonSize
    secondary?: boolean
    quaternary?: boolean
    ghost?: boolean
    loading?: boolean
    disabled?: boolean
    block?: boolean
    nativeType?: 'button' | 'submit' | 'reset'
  }>(),
  {
    type: 'default',
    size: 'medium',
    nativeType: 'button',
  },
)

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>()

const variantClass = computed(() => {
  // Quaternary / ghost map to subtle/ghost variants.
  if (props.quaternary) {
    if (props.type === 'error') return 'btn-danger-ghost'
    return 'btn-ghost'
  }
  if (props.secondary || props.ghost) {
    if (props.type === 'error') return 'btn-danger-ghost'
    if (props.type === 'warning') return 'btn-warning-ghost'
    return 'btn-secondary'
  }
  switch (props.type) {
    case 'primary':
      return 'btn-primary'
    case 'success':
      return 'btn-success'
    case 'error':
      return 'btn-danger'
    case 'warning':
      return 'btn-warning'
    default:
      return 'btn-secondary'
  }
})

const sizeClass = computed(() => {
  switch (props.size) {
    case 'tiny':
      return 'btn-xs'
    case 'small':
      return 'btn-sm'
    case 'large':
      return 'btn-lg'
    default:
      return ''
  }
})

function onClick(ev: MouseEvent) {
  if (props.disabled || props.loading) return
  emit('click', ev)
}
</script>

<template>
  <button
    :type="nativeType"
    class="btn"
    :class="[variantClass, sizeClass, block && 'btn-block']"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <span v-if="loading" class="spinner h-4 w-4" aria-hidden="true" />
    <slot />
  </button>
</template>
