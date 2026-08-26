<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import type * as echarts from 'echarts/core'

const EChart = defineAsyncComponent(() => import('./EChart.vue'))

const props = withDefaults(
  defineProps<{
    option: echarts.EChartsCoreOption
    height?: string
  }>(),
  { height: '320px' },
)

const target = ref<HTMLDivElement | null>(null)
const visible = ref(false)
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (!target.value || typeof IntersectionObserver === 'undefined') {
    visible.value = true
    return
  }

  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        visible.value = true
        observer?.disconnect()
        observer = null
      }
    },
    { rootMargin: '200px' },
  )
  observer.observe(target.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div ref="target" :style="{ minHeight: height }">
    <EChart v-if="visible" :option="props.option" :height="props.height" />
  </div>
</template>
