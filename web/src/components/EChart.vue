<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

// Register the minimal set of ECharts modules we use. Tree-shakes the rest.
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
])

const props = withDefaults(
  defineProps<{
    option: echarts.EChartsCoreOption
    height?: string
  }>(),
  { height: '320px' },
)

const root = ref<HTMLDivElement | null>(null)
let instance: echarts.ECharts | null = null

function resize() {
  instance?.resize()
}

onMounted(() => {
  if (!root.value) return
  instance = echarts.init(root.value)
  instance.setOption(props.option)
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  instance?.dispose()
  instance = null
})

watch(
  () => props.option,
  (next) => {
    if (instance) instance.setOption(next, true)
  },
  { deep: true },
)
</script>

<template>
  <div ref="root" :style="{ width: '100%', height }" />
</template>
