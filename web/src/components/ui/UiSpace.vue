<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    vertical?: boolean
    justify?: 'start' | 'end' | 'center' | 'space-between' | 'space-around'
    align?: 'start' | 'end' | 'center' | 'baseline' | 'stretch'
    size?: number | 'small' | 'medium' | 'large'
    wrap?: boolean
  }>(),
  { wrap: true },
)

const gap = computed(() => {
  if (typeof props.size === 'number') return `${props.size}px`
  switch (props.size) {
    case 'small':
      return '8px'
    case 'large':
      return '24px'
    default:
      return '12px'
  }
})

const justifyClass = computed(() => {
  switch (props.justify) {
    case 'end':
      return 'justify-end'
    case 'center':
      return 'justify-center'
    case 'space-between':
      return 'justify-between'
    case 'space-around':
      return 'justify-around'
    default:
      return 'justify-start'
  }
})

const alignClass = computed(() => {
  switch (props.align) {
    case 'center':
      return 'items-center'
    case 'end':
      return 'items-end'
    case 'baseline':
      return 'items-baseline'
    case 'stretch':
      return 'items-stretch'
    default:
      return 'items-start'
  }
})
</script>

<template>
  <div
    class="flex"
    :class="[
      vertical ? 'flex-col' : 'flex-row',
      !vertical && wrap && 'flex-wrap',
      justifyClass,
      alignClass,
    ]"
    :style="{ gap }"
  >
    <slot />
  </div>
</template>
