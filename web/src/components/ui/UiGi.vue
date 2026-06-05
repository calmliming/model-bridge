<script setup lang="ts">
import { computed, inject, type ComputedRef } from 'vue'
import { resolveSpan, type Breakpoint } from '../../composables/useBreakpoint'

const props = withDefaults(defineProps<{ span?: string | number }>(), { span: 1 })

const grid = inject<{ cols: ComputedRef<number>; breakpoint: ComputedRef<Breakpoint> }>('uiGrid')

const span = computed(() => {
  const bp = grid?.breakpoint.value ?? 'l'
  const resolved = resolveSpan(props.span, bp)
  const total = grid?.cols.value ?? 24
  return Math.min(resolved, total)
})
</script>

<template>
  <div :style="{ gridColumn: `span ${span} / span ${span}` }">
    <slot />
  </div>
</template>
