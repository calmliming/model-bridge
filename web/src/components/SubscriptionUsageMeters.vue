<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { SubscriptionUsageWindow } from '../billing'
import { formatTime } from '../utils'
defineProps<{ windows: SubscriptionUsageWindow[]; expired?: boolean }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => clearInterval(timer))
const labels = { fiveHour: '当前 5 小时', weekly: '每周用量', monthly: '本月用量' }
function resetLabel(window: SubscriptionUsageWindow) {
  if (window.resetsAt == null) return '首次使用后开始 5 小时计时'
  const minutes = Math.max(0, Math.ceil((window.resetsAt - now.value) / 60_000))
  if (!minutes) return '正在等待刷新'
  if (minutes < 60) return `${minutes} 分钟后重置`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟后重置`
  return `${Math.floor(minutes / (24 * 60))} 天 ${Math.floor(minutes / 60) % 24} 小时后重置`
}
</script>

<template>
  <div class="subscription-meters">
    <section v-for="window in windows" :key="window.key" class="usage-meter" :class="{ exhausted: window.remaining === 0 }">
      <div class="meter-heading"><span>{{ labels[window.key] }}</span><strong>{{ window.percent.toFixed(1).replace(/\.0$/, '') }}<small>% 已用</small></strong></div>
      <div class="meter-track" role="progressbar" :aria-label="labels[window.key]" :aria-valuenow="Math.round(window.percent * 10) / 10" :aria-valuemin="0" :aria-valuemax="100"><span :style="{ width: `${window.percent}%` }" /></div>
      <p :title="window.resetsAt ? formatTime(window.resetsAt) : undefined">{{ expired ? '订阅已结束' : resetLabel(window) }}</p>
      <span v-if="window.remaining === 0 && !expired" class="exhausted-note">本窗口额度已用尽</span>
    </section>
  </div>
</template>

<style scoped>
.subscription-meters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; width: 100%; }
.usage-meter { min-width: 0; padding: 16px; background: #f7faf8; border: 1px solid #e5ece8; border-radius: 12px; }
.meter-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; color: #587367; }
.meter-heading strong { color: #244b3e; font-size: 20px; font-variant-numeric: tabular-nums; }
.meter-heading small { font-size: 11px; font-weight: 400; margin-left: 3px; white-space: nowrap; }
.meter-track { height: 6px; background: #e0ece6; border-radius: 4px; margin: 12px 0 9px; overflow: hidden; }
.meter-track span { display: block; height: 100%; background: #21957b; border-radius: inherit; transition: width .2s; }
.usage-meter p { font-size: 11px; line-height: 1.5; color: #688175; }
.exhausted .meter-track span { background: #c36a32; }
.exhausted-note { display: block; font-size: 11px; color: #a65827; margin-top: 4px; }
:global(.dark) .usage-meter { background: #19302a; border-color: #344e44; }
:global(.dark) .meter-heading, :global(.dark) .usage-meter p { color: #a3c1b4; }
:global(.dark) .meter-heading strong { color: #cfe9dd; }
:global(.dark) .meter-track { background: #355749; }
:global(.dark) .exhausted-note { color: #efbd80; }
@media (max-width: 700px) { .subscription-meters { grid-template-columns: 1fr; gap: 10px; } }
@media (prefers-reduced-motion: reduce) { .meter-track span { transition: none; } }
</style>
