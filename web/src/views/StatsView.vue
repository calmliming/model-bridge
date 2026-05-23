<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import EChart from '../components/EChart.vue'
import { api, errMsg } from '../api/client'

interface DailyStat {
  day: string
  requests: number
  inputTokens: number
  outputTokens: number
  cost: number
}
interface ProviderStat {
  provider: string
  requests: number
  tokens: number
  cost: number
}
interface ModelStat {
  model: string
  requests: number
  tokens: number
  cost: number
}
interface KeyStat {
  id: string
  name: string
  ownerLabel: string | null
  requests: number
  tokens: number
  cost: number
}
interface Summary {
  rangeDays: number
  totals: { requests: number; inputTokens: number; outputTokens: number; cost: number }
  daily: DailyStat[]
  byProvider: ProviderStat[]
  byModel: ModelStat[]
  byKey: KeyStat[]
}

const message = useMessage()
const loading = ref(true)
const range = ref<7 | 30 | 90>(30)
const summary = ref<Summary | null>(null)

const PROVIDER_COLOR: Record<string, string> = {
  claude: '#d97757',
  openai: '#10a37f',
  gemini: '#4285f4',
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/stats/summary', { params: { days: range.value } })
    summary.value = data
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

watch(range, load)
onMounted(load)

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatCost(c: number): string {
  return `$${c.toFixed(c < 1 ? 4 : 2)}`
}

const cards = computed(() => {
  const t = summary.value?.totals ?? { requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
  return [
    { label: '请求数', value: formatNumber(t.requests), hint: '中转请求总数' },
    {
      label: 'Token 总量',
      value: formatNumber(t.inputTokens + t.outputTokens),
      hint: `输入 ${formatNumber(t.inputTokens)} · 输出 ${formatNumber(t.outputTokens)}`,
    },
    { label: '估算成本', value: formatCost(t.cost), hint: '按各服务商市价折算' },
  ]
})

const dailyOption = computed(() => {
  const series = summary.value?.daily ?? []
  return {
    grid: { left: 50, right: 24, top: 36, bottom: 36 },
    tooltip: { trigger: 'axis' },
    legend: { right: 0, top: 0, textStyle: { color: '#475569' } },
    xAxis: {
      type: 'category',
      data: series.map((d) => d.day.slice(5)), // MM-DD
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { color: '#64748b', fontSize: 11 },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Tokens',
        axisLabel: { color: '#64748b', fontSize: 11 },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      {
        type: 'value',
        name: 'Requests',
        axisLabel: { color: '#64748b', fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Tokens',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: series.map((d) => d.inputTokens + d.outputTokens),
        areaStyle: { opacity: 0.15, color: '#2563eb' },
        lineStyle: { color: '#2563eb', width: 2 },
        itemStyle: { color: '#2563eb' },
      },
      {
        name: 'Requests',
        type: 'line',
        smooth: true,
        symbol: 'none',
        yAxisIndex: 1,
        data: series.map((d) => d.requests),
        lineStyle: { color: '#14b8a6', width: 2 },
        itemStyle: { color: '#14b8a6' },
      },
    ],
  }
})

const providerOption = computed(() => {
  const rows = summary.value?.byProvider ?? []
  return {
    grid: { left: 60, right: 24, top: 16, bottom: 32 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 11 },
      splitLine: { lineStyle: { color: '#e2e8f0' } },
    },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.provider),
      axisLabel: { color: '#0f172a', fontSize: 12, fontWeight: 600 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => ({
          value: r.tokens,
          itemStyle: { color: PROVIDER_COLOR[r.provider] ?? '#6366f1' },
        })),
        barWidth: 18,
        label: { show: true, position: 'right', color: '#475569', fontSize: 11 },
      },
    ],
  }
})

const modelOption = computed(() => {
  const rows = summary.value?.byModel ?? []
  return {
    grid: { left: 160, right: 24, top: 16, bottom: 32 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'value',
      axisLabel: { color: '#64748b', fontSize: 11 },
      splitLine: { lineStyle: { color: '#e2e8f0' } },
    },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.model),
      axisLabel: { color: '#0f172a', fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false },
      inverse: true,
    },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => r.tokens),
        barWidth: 14,
        itemStyle: { color: '#6366f1', borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: '#475569', fontSize: 11 },
      },
    ],
  }
})

const keyColumns: DataTableColumns<KeyStat> = [
  { title: '名称', key: 'name' },
  {
    title: '持有者',
    key: 'ownerLabel',
    render: (row) => row.ownerLabel ?? '—',
  },
  {
    title: '请求数',
    key: 'requests',
    render: (row) => formatNumber(row.requests),
  },
  {
    title: 'Token',
    key: 'tokens',
    render: (row) => formatNumber(row.tokens),
  },
  {
    title: '估算成本',
    key: 'cost',
    render: (row) => formatCost(row.cost),
  },
]

const rangeLabel = (d: number) => `近 ${d} 天`
</script>

<template>
  <div class="stats-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">用量统计</h2>
        <div class="page-subtitle">Token 消耗、成本与中转请求趋势。</div>
      </div>
      <n-radio-group v-model:value="range" size="small">
        <n-radio-button :value="7">{{ rangeLabel(7) }}</n-radio-button>
        <n-radio-button :value="30">{{ rangeLabel(30) }}</n-radio-button>
        <n-radio-button :value="90">{{ rangeLabel(90) }}</n-radio-button>
      </n-radio-group>
    </div>

    <n-grid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <n-gi v-for="c in cards" :key="c.label" span="3 m:1">
        <n-card class="metric-card" :bordered="false">
          <div class="metric-label">{{ c.label }}</div>
          <div class="metric-value">{{ c.value }}</div>
          <div class="metric-hint">{{ c.hint }}</div>
        </n-card>
      </n-gi>
    </n-grid>

    <n-card class="chart-card" title="每日趋势" :bordered="false">
      <EChart :option="dailyOption" height="300px" />
    </n-card>

    <n-grid :cols="2" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <n-gi span="2 m:1">
        <n-card class="chart-card" title="按服务商" :bordered="false">
          <EChart :option="providerOption" height="220px" />
          <n-text v-if="!summary?.byProvider.length" depth="3" style="font-size: 13px">
            暂无数据
          </n-text>
        </n-card>
      </n-gi>
      <n-gi span="2 m:1">
        <n-card class="chart-card" title="按模型（Top 10）" :bordered="false">
          <EChart :option="modelOption" height="220px" />
          <n-text v-if="!summary?.byModel.length" depth="3" style="font-size: 13px">
            暂无数据
          </n-text>
        </n-card>
      </n-gi>
    </n-grid>

    <n-card class="table-card" title="按 API Key" :bordered="false">
      <n-data-table
        :columns="keyColumns"
        :data="summary?.byKey ?? []"
        :loading="loading"
        :bordered="false"
      />
    </n-card>
  </div>
</template>

<style scoped>
.stats-page {
  display: grid;
  gap: 16px;
}

.metric-card .metric-label {
  color: rgba(15, 23, 42, 0.54);
  font-size: 13px;
}

.metric-card .metric-value {
  margin-top: 8px;
  color: #0f172a;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.metric-card .metric-hint {
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.42);
  font-size: 12px;
}
</style>
