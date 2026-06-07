<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { UiTag } from '../components/ui'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import EChart from '../components/EChart.vue'
import { api, errMsg } from '../api/client'

interface DailyStat {
  day: string
  requests: number
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
}
interface ProviderStat {
  provider: string
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
}
interface ModelStat {
  model: string
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
}
interface KeyStat {
  id: string
  name: string
  ownerLabel: string | null
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
}
interface Summary {
  rangeDays: number
  totals: {
    requests: number
    inputTokens: number
    outputTokens: number
    cacheCreateTokens: number
    cacheReadTokens: number
    cost: number
  }
  daily: DailyStat[]
  byProvider: ProviderStat[]
  byModel: ModelStat[]
  byKey: KeyStat[]
}

const message = useMessage()
const loading = ref(true)
const range = ref<1 | 7 | 30>(1)
const summary = ref<Summary | null>(null)

const PROVIDER_COLOR: Record<string, string> = {
  claude: '#d97757',
  openai: '#10a37f',
  gemini: '#4285f4',
}

const MODEL_COLOR = ['#2563eb', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

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

function totalTokens(row: Pick<DailyStat, 'inputTokens' | 'outputTokens' | 'cacheCreateTokens' | 'cacheReadTokens'>): number {
  return row.inputTokens + row.outputTokens + row.cacheCreateTokens + row.cacheReadTokens
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return formatNumber(n)
}

function percent(value: number, total: number): string {
  if (!total) return '0.00%'
  return `${((value / total) * 100).toFixed(2)}%`
}

function modelFamily(model: string): string {
  const lower = model.toLowerCase()
  if (lower.includes('claude')) return 'Claude'
  if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4')) return 'GPT'
  if (lower.includes('gemini')) return 'Gemini'
  return 'Other'
}

const cards = computed(() => {
  const t = summary.value?.totals ?? {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    cost: 0,
  }
  return [
    { label: '请求数', value: formatNumber(t.requests), hint: '中转请求总数', tone: 'blue' },
    {
      label: 'Token 总量',
      value: formatNumber(totalTokens(t)),
      hint: `输入 ${formatNumber(t.inputTokens)} · 输出 ${formatNumber(t.outputTokens)} · 缓存 ${formatNumber(t.cacheCreateTokens + t.cacheReadTokens)}`,
      tone: 'green',
    },
    { label: '缓存 Token', value: formatNumber(t.cacheCreateTokens + t.cacheReadTokens), hint: `写入 ${formatNumber(t.cacheCreateTokens)} · 读取 ${formatNumber(t.cacheReadTokens)}`, tone: 'violet' },
    { label: '估算成本', value: formatCost(t.cost), hint: '按各服务商市价折算', tone: 'amber' },
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
        name: '输入 Token',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: series.map((d) => d.inputTokens),
        areaStyle: { opacity: 0.08, color: '#2563eb' },
        lineStyle: { color: '#2563eb', width: 2 },
        itemStyle: { color: '#2563eb' },
      },
      {
        name: '输出 Token',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: series.map((d) => d.outputTokens),
        lineStyle: { color: '#14b8a6', width: 2 },
        itemStyle: { color: '#14b8a6' },
      },
      {
        name: '缓存写入',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: series.map((d) => d.cacheCreateTokens),
        lineStyle: { color: '#f59e0b', width: 2 },
        itemStyle: { color: '#f59e0b' },
      },
      {
        name: '缓存读取',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: series.map((d) => d.cacheReadTokens),
        lineStyle: { color: '#8b5cf6', width: 2 },
        itemStyle: { color: '#8b5cf6' },
      },
      {
        name: '请求数',
        type: 'line',
        smooth: true,
        symbol: 'none',
        yAxisIndex: 1,
        data: series.map((d) => d.requests),
        lineStyle: { color: '#94a3b8', width: 1.5, type: 'dashed' },
        itemStyle: { color: '#94a3b8' },
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

const modelTotalTokens = computed(() =>
  (summary.value?.byModel ?? []).reduce((sum, row) => sum + row.tokens, 0),
)

const modelColumns = computed<TableColumn<ModelStat>[]>(() => [
  {
    title: '模型',
    key: 'model',
    minWidth: 180,
    render: (row) =>
      h('div', { class: 'model-name-cell' }, [
        h('strong', null, row.model),
        h(UiTag, { size: 'small', bordered: false, type: 'info' }, { default: () => modelFamily(row.model) }),
      ]),
  },
  { title: 'Token', key: 'tokens', minWidth: 110, render: (row) => compactNumber(row.tokens) },
  { title: '输入', key: 'inputTokens', minWidth: 100, render: (row) => compactNumber(row.inputTokens) },
  { title: '输出', key: 'outputTokens', minWidth: 100, render: (row) => compactNumber(row.outputTokens) },
  { title: '缓存写入', key: 'cacheCreateTokens', minWidth: 100, render: (row) => compactNumber(row.cacheCreateTokens) },
  { title: '缓存读取', key: 'cacheReadTokens', minWidth: 100, render: (row) => compactNumber(row.cacheReadTokens) },
  { title: '占比', key: 'share', minWidth: 90, render: (row) => percent(row.tokens, modelTotalTokens.value) },
])

const topModelRows = computed(() => (summary.value?.byModel ?? []).slice(0, 6))

const keyColumns: TableColumn<KeyStat>[] = [
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

const rangeLabel = (d: number) => (d === 1 ? '今天' : `${d} 天`)
</script>

<template>
  <div class="stats-page">
    <div class="stats-head">
      <div>
        <h2>用量统计</h2>
        <p>按 token、模型、服务商和 API Key 查看中转消耗。</p>
      </div>
      <UiRadioGroup v-model:value="range" size="small">
        <UiRadioButton :value="1">{{ rangeLabel(1) }}</UiRadioButton>
        <UiRadioButton :value="7">{{ rangeLabel(7) }}</UiRadioButton>
        <UiRadioButton :value="30">{{ rangeLabel(30) }}</UiRadioButton>
      </UiRadioGroup>
    </div>

    <div class="metric-grid">
      <UiCard v-for="c in cards" :key="c.label" class="metric-card" :class="`tone-${c.tone}`" :bordered="false">
        <div class="metric-label">{{ c.label }}</div>
        <div class="metric-value">{{ c.value }}</div>
        <div class="metric-hint">{{ c.hint }}</div>
      </UiCard>
    </div>

    <UiCard class="panel-card trend-card" :bordered="false">
      <div class="section-head">
        <div>
          <h3>Token 走势</h3>
          <p>输入、输出、缓存写入和缓存读取的每日变化。</p>
        </div>
      </div>
      <EChart :option="dailyOption" height="320px" />
    </UiCard>

    <UiCard class="panel-card model-usage-card" :bordered="false">
      <div class="section-head">
        <div>
          <h3>模型使用情况</h3>
          <p>按 token 统计模型占比，包含输入、输出和缓存明细。</p>
        </div>
      </div>
      <div class="model-usage-grid">
        <div class="model-distribution">
          <div class="distribution-top">
            <div>
              <div class="distribution-title">Token 分布</div>
              <div class="distribution-subtitle">Top {{ topModelRows.length }} 模型</div>
            </div>
            <div class="distribution-total">
              {{ compactNumber(modelTotalTokens) }}
              <span>Token</span>
            </div>
          </div>
          <div v-if="summary?.byModel.length" class="distribution-list">
            <div
              v-for="(row, index) in topModelRows"
              :key="row.model"
              class="distribution-row"
            >
              <div class="distribution-row-head">
                <span>
                  <i :style="{ background: MODEL_COLOR[index % MODEL_COLOR.length] }" />
                  {{ row.model }}
                </span>
                <strong>{{ percent(row.tokens, modelTotalTokens) }}</strong>
              </div>
              <div class="distribution-bar">
                <span
                  :style="{
                    width: percent(row.tokens, modelTotalTokens),
                    background: MODEL_COLOR[index % MODEL_COLOR.length],
                  }"
                />
              </div>
            </div>
          </div>
          <UiText v-else depth="3" style="font-size: 13px">暂无数据</UiText>
        </div>
        <div class="model-table-wrap">
          <UiDataTable
            :columns="modelColumns"
            :data="summary?.byModel ?? []"
            :loading="loading"
            :bordered="false"
            :scroll-x="780"
          />
        </div>
      </div>
    </UiCard>

    <div class="lower-grid">
        <UiCard class="panel-card" :bordered="false">
          <div class="section-head compact">
            <div>
              <h3>按服务商</h3>
              <p>服务商 token 消耗占比。</p>
            </div>
          </div>
          <EChart :option="providerOption" height="220px" />
          <UiText v-if="!summary?.byProvider.length" depth="3" style="font-size: 13px">
            暂无数据
          </UiText>
        </UiCard>

      <UiCard class="panel-card" :bordered="false">
        <div class="section-head compact">
          <div>
            <h3>按 API Key</h3>
            <p>查看每个 Key 的请求、token 和成本。</p>
          </div>
        </div>
        <UiDataTable
          :columns="keyColumns"
          :data="summary?.byKey ?? []"
          :loading="loading"
          :bordered="false"
          :scroll-x="680"
        />
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.stats-page {
  display: grid;
  gap: 18px;
}

.stats-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.stats-head h2 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  font-weight: 850;
}

.stats-head p {
  margin: 6px 0 0;
  color: rgba(15, 23, 42, 0.52);
  font-size: 13px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.panel-card,
.metric-card {
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 8px;
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.05);
}

.metric-card {
  position: relative;
  overflow: hidden;
}

.metric-card::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  content: '';
  background: #2563eb;
}

.metric-card.tone-green::before {
  background: #14b8a6;
}

.metric-card.tone-violet::before {
  background: #8b5cf6;
}

.metric-card.tone-amber::before {
  background: #f59e0b;
}

.metric-card .metric-label {
  color: rgba(15, 23, 42, 0.54);
  font-size: 13px;
}

.metric-card .metric-value {
  margin-top: 10px;
  color: #0f172a;
  font-size: 28px;
  font-weight: 850;
  letter-spacing: 0;
}

.metric-card .metric-hint {
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.42);
  font-size: 12px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.section-head.compact {
  margin-bottom: 10px;
}

.section-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 17px;
  font-weight: 850;
}

.section-head p {
  margin: 5px 0 0;
  color: rgba(15, 23, 42, 0.52);
  font-size: 13px;
}

.model-usage-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.85fr) minmax(560px, 1.65fr);
  gap: 16px;
  align-items: stretch;
}

.model-distribution {
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  background: #fbfdff;
}

.distribution-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.distribution-title {
  color: #0f172a;
  font-size: 15px;
  font-weight: 800;
}

.distribution-subtitle {
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.5);
  font-size: 12px;
}

.distribution-total {
  color: #0f172a;
  font-size: 24px;
  font-weight: 850;
  line-height: 1.1;
  text-align: right;
  white-space: nowrap;
}

.distribution-total span {
  margin-left: 4px;
  color: rgba(15, 23, 42, 0.52);
  font-size: 14px;
  font-weight: 650;
}

.distribution-list {
  display: grid;
  gap: 13px;
  margin-top: 20px;
}

.distribution-row {
  min-width: 0;
}

.distribution-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  color: #0f172a;
  font-size: 13px;
}

.distribution-row-head span {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.distribution-row-head i {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.distribution-row-head strong {
  flex: 0 0 auto;
  font-weight: 700;
}

.distribution-bar {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #e2e8f0;
}

.distribution-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.model-table-wrap {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
}

.lower-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.8fr) minmax(520px, 1.2fr);
  gap: 16px;
}

:deep(.model-name-cell) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

:deep(.model-name-cell strong) {
  overflow: hidden;
  color: #0f172a;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 900px) {
  .stats-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .model-usage-grid {
    grid-template-columns: 1fr;
  }

  .lower-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .stats-head h2 {
    font-size: 20px;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .metric-card .metric-value {
    font-size: 24px;
  }
}
</style>
