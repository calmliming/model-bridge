<script setup lang="ts">
import { computed, provide } from 'vue'
import { bpFromWidth, useBreakpoint, type Breakpoint } from '../../composables/useBreakpoint'

const props = withDefaults(
  defineProps<{
    cols?: number
    xGap?: number
    yGap?: number
    responsive?: string
    itemResponsive?: boolean
  }>(),
  { cols: 24, xGap: 0, yGap: 0 },
)

const { width } = useBreakpoint()
const breakpoint = computed<Breakpoint>(() => bpFromWidth(width.value))

const cols = computed(() => props.cols)

provide('uiGrid', { cols, breakpoint })
</script>

<template>
  <div
    class="grid"
    :style="{
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      columnGap: `${xGap}px`,
      rowGap: `${yGap}px`,
    }"
  >
    <slot />
  </div>
</template>
