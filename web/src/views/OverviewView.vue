<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from '../composables/useMessage'
import EChart from '../components/EChart.vue'
import { api, errMsg } from '../api/client'
import { formatTime, formatTokens } from '../utils'

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

interface DashboardAccount {
  id: string
  provider: string
  name: string
  status: string
  cooldownUntil: number | null
  tokenExpiresAt: number | null
  lastUsedAt: number | null
  createdAt: number
}

interface DashboardKey {
  id: string
  name: string
  ownerLabel: string | null
  keyPrefix: string
  enabled: boolean
  quotaLimit: number | null
  quotaUsed: number
  lastUsedAt: number | null
  requests: number
  tokens: number
  cost: number
}

interface DashboardRecentLog {
  id: string
  ts: number
  provider: string
  model: string | null
  status: string
  latencyMs: number | null
  firstTokenMs: number | null
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
  baseCost: number
  billTo: string
  inputCost: number
  outputCost: number
  cacheCreateCost: number
  cacheReadCost: number
  inputPrice: number | null
  outputPrice: number | null
  cacheCreatePrice: number | null
  cacheReadPrice: number | null
  apiKeyName: string | null
  accountName: string | null
  requestInput: string | null
}

interface DashboardOverview {
  totals: {
    keyCount: number
    enabledKeyCount: number
    accountCount: number
    activeAccountCount: number
    coolingAccountCount: number
    disabledAccountCount: number
    errorAccountCount: number
    totalUsers: number
    activeUsers24h: number
    newUsers24h: number
    requestCount: number
    totalTokens: number
    totalCost: number
    requests24h: number
    tokens24h: number
    cost24h: number
    success24h: number
    avgLatencyMs24h: number
    rpm5m: number
    tpm5m: number
    tokens30d: number
    cost30d: number
  }
  daily: DailyStat[]
  byProvider: ProviderStat[]
  accounts: DashboardAccount[]
  keys: DashboardKey[]
}

interface DashboardRecentLogsPage {
  page: number
  pageSize: number
  total: number
  logs: DashboardRecentLog[]
}

const message = useMessage()
const loading = ref(true)
const recentLoading = ref(true)
const dashboard = ref<DashboardOverview | null>(null)
const recentPage = ref(1)
const recentLogs = ref<DashboardRecentLog[]>([])
const recentTotal = ref(0)
const selectedLog = ref<DashboardRecentLog | null>(null)
const recentProviderFilter = ref<string | null>(null)
const recentModelFilter = ref('')
const recentKeyFilter = ref('')
const RECENT_PAGE_SIZE = 10

const emptyTotals: DashboardOverview['totals'] = {
  keyCount: 0,
  enabledKeyCount: 0,
  accountCount: 0,
  activeAccountCount: 0,
  coolingAccountCount: 0,
  disabledAccountCount: 0,
  errorAccountCount: 0,
  totalUsers: 0,
  activeUsers24h: 0,
  newUsers24h: 0,
  requestCount: 0,
  totalTokens: 0,
  totalCost: 0,
  requests24h: 0,
  tokens24h: 0,
  cost24h: 0,
  success24h: 0,
  avgLatencyMs24h: 0,
  rpm5m: 0,
  tpm5m: 0,
  tokens30d: 0,
  cost30d: 0,
}

const providerLabels: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  xiaomi: 'Xiaomi MiMo',
  zhipu: 'Zhipu GLM',
}

const providerColors: Record<string, string> = {
  claude: '#d97757',
  openai: '#10a37f',
  gemini: '#4285f4',
  deepseek: '#6366f1',
  xiaomi: '#ff6900',
  zhipu: '#7c3aed',
}

interface ToneColor {
  icon: string
  iconBg: string
  blob: string
}

const toneColors: Record<string, ToneColor> = {
  blue: { icon: '#2563eb', iconBg: 'rgba(37, 99, 235, 0.13)', blob: '#2563eb' },
  green: { icon: '#0d9488', iconBg: 'rgba(20, 184, 166, 0.14)', blob: '#14b8a6' },
  violet: { icon: '#8b5cf6', iconBg: 'rgba(139, 92, 246, 0.14)', blob: '#8b5cf6' },
  amber: { icon: '#d97706', iconBg: 'rgba(245, 158, 11, 0.17)', blob: '#f59e0b' },
  teal: { icon: '#0d9488', iconBg: 'rgba(13, 148, 136, 0.14)', blob: '#0d9488' },
  cyan: { icon: '#0891b2', iconBg: 'rgba(6, 182, 212, 0.14)', blob: '#06b6d4' },
  indigo: { icon: '#4f46e5', iconBg: 'rgba(99, 102, 241, 0.15)', blob: '#6366f1' },
  rose: { icon: '#e11d48', iconBg: 'rgba(244, 63, 94, 0.14)', blob: '#f43f5e' },
}

const statIconPaths: Record<string, string[]> = {
  key: [
    'M15.5 7.5a4.5 4.5 0 1 0-3.2 7.7l-1.8 1.8H8.5v2H6.5v2H3.5v-3.1l5.3-5.3a4.5 4.5 0 0 0 6.7-5.1Z',
    'M14.6 7.4h.01',
  ],
  server: [
    'M4 6.5h16v5H4z',
    'M4 14.5h16v5H4z',
    'M8 9h.01',
    'M8 17h.01',
    'M12 9h4',
    'M12 17h4',
  ],
  chart: [
    'M5 19V9',
    'M12 19V5',
    'M19 19v-8',
    'M4 19h16',
  ],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2',
    'M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M21 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  cube: [
    'm21 16-9 5-9-5V8l9-5 9 5v8Z',
    'm3.3 7.4 8.7 5 8.7-5',
    'M12 22V12',
  ],
  database: [
    'M12 5c4.4 0 8 1.57 8 3.5S16.4 12 12 12s-8-1.57-8-3.5S7.6 5 12 5Z',
    'M4 8.5v7c0 1.93 3.6 3.5 8 3.5s8-1.57 8-3.5v-7',
    'M4 12c0 1.93 3.6 3.5 8 3.5s8-1.57 8-3.5',
  ],
  zap: [
    'm13 2-9 12h7l-1 8 9-12h-7l1-8Z',
  ],
  clock: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M12 7v5l3 2',
  ],
}

const totals = computed(() => dashboard.value?.totals ?? emptyTotals)
const providerRows = computed(() => dashboard.value?.byProvider ?? [])

const recentProviderOptions = computed(() => {
  const providers = new Set<string>(Object.keys(providerLabels))
  for (const row of providerRows.value) providers.add(row.provider)
  for (const row of recentLogs.value) providers.add(row.provider)
  return Array.from(providers).map((provider) => ({
    label: providerLabel(provider),
    value: provider,
  }))
})

const hasRecentFilters = computed(
  () => !!recentProviderFilter.value || !!recentModelFilter.value.trim() || !!recentKeyFilter.value.trim(),
)

const recentEmptyText = computed(() => {
  if (recentLoading.value) return '加载中...'
  return hasRecentFilters.value ? '没有匹配的请求记录' : '暂无请求记录'
})

const successRate24h = computed(() => {
  const { requests24h, success24h } = totals.value
  if (requests24h <= 0) return null
  return (success24h / requests24h) * 100
})

const cards = computed(() => [
  {
    label: 'API Keys',
    value: formatNumber(totals.value.keyCount),
    hint: `${formatNumber(totals.value.enabledKeyCount)} 个启用`,
    tone: 'blue',
    icon: 'key',
  },
  {
    label: '服务账号',
    value: formatNumber(totals.value.accountCount),
    hint: `${formatNumber(totals.value.activeAccountCount)} 正常 · ${formatNumber(totals.value.errorAccountCount)} 异常`,
    tone: 'green',
    icon: 'server',
  },
  {
    label: '今日请求',
    value: formatNumber(totals.value.requests24h),
    hint: `累计 ${formatNumber(totals.value.requestCount)} 次`,
    tone: 'violet',
    icon: 'chart',
  },
  {
    label: '用户',
    value: formatNumber(totals.value.totalUsers),
    hint: `今日新增 ${formatNumber(totals.value.newUsers24h)} · 活跃 ${formatNumber(totals.value.activeUsers24h)}`,
    tone: 'cyan',
    icon: 'users',
  },
  {
    label: '今日 Tokens',
    value: formatTokens(totals.value.tokens24h),
    hint: `费用 ${formatCost(totals.value.cost24h)}`,
    tone: 'amber',
    icon: 'cube',
  },
  {
    label: '累计 Tokens',
    value: formatTokens(totals.value.totalTokens),
    hint: `累计费用 ${formatCost(totals.value.totalCost)}`,
    tone: 'indigo',
    icon: 'database',
  },
  {
    label: '性能',
    value: `${formatRate(totals.value.rpm5m)} RPM`,
    hint: `${formatRate(totals.value.tpm5m)} TPM · 近 5 分钟`,
    tone: 'teal',
    icon: 'zap',
  },
  {
    label: '平均响应',
    value: formatDuration(totals.value.avgLatencyMs24h),
    hint:
      successRate24h.value == null
        ? '暂无今日请求'
        : `今日成功率 ${successRate24h.value.toFixed(1)}%`,
    tone: 'rose',
    icon: 'clock',
  },
])

const dailyOption = computed(() => {
  const series = dashboard.value?.daily ?? []
  return {
    grid: { left: 42, right: 48, top: 34, bottom: 34 },
    tooltip: { trigger: 'axis' },
    legend: { right: 0, top: 0, textStyle: { color: '#64748b' } },
    xAxis: {
      type: 'category',
      data: series.map((d) => d.day.slice(5)),
      axisLine: { lineStyle: { color: '#cbd5e1' } },
      axisLabel: { color: '#64748b', fontSize: 11 },
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 11 },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      {
        type: 'value',
        axisLabel: { color: '#64748b', fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '请求',
        type: 'bar',
        data: series.map((d) => d.requests),
        barWidth: 14,
        itemStyle: { color: '#2563eb', borderRadius: [4, 4, 0, 0] },
      },
      {
        name: 'Tokens',
        type: 'line',
        smooth: true,
        symbol: 'none',
        yAxisIndex: 1,
        data: series.map((d) => d.inputTokens + d.outputTokens),
        lineStyle: { color: '#14b8a6', width: 2 },
        areaStyle: { color: '#14b8a6', opacity: 0.1 },
      },
    ],
  }
})

const providerOption = computed(() => {
  const rows = providerRows.value
  const data = rows.map((row) => ({
    name: providerLabel(row.provider),
    value: row.tokens || row.requests,
    itemStyle: { color: providerColors[row.provider] ?? '#6366f1' },
  }))
  return {
    tooltip: { trigger: 'item' },
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'center',
      textStyle: { color: '#475569' },
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['34%', '52%'],
        avoidLabelOverlap: true,
        label: { show: false },
        data,
      },
    ],
  }
})

watch(recentPage, () => {
  loadRecentLogs()
})

onMounted(load)

async function load() {
  await Promise.all([loadOverview(), loadRecentLogs()])
}

async function loadOverview() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/overview')
    dashboard.value = data
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

async function loadRecentLogs() {
  recentLoading.value = true
  try {
    const params: Record<string, string | number> = {
      page: recentPage.value,
      pageSize: RECENT_PAGE_SIZE,
    }
    if (recentProviderFilter.value) params.provider = recentProviderFilter.value
    if (recentModelFilter.value.trim()) params.model = recentModelFilter.value.trim()
    if (recentKeyFilter.value.trim()) params.key = recentKeyFilter.value.trim()
    const { data } = await api.get<DashboardRecentLogsPage>('/admin/overview/recent-logs', {
      params,
    })
    recentLogs.value = data.logs
    recentTotal.value = data.total
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    recentLoading.value = false
  }
}

function applyRecentFilters() {
  if (recentPage.value === 1) {
    loadRecentLogs()
    return
  }
  recentPage.value = 1
}

function resetRecentFilters() {
  recentProviderFilter.value = null
  recentModelFilter.value = ''
  recentKeyFilter.value = ''
  applyRecentFilters()
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function formatRate(n: number): string {
  const value = Number.isFinite(n) ? n : 0
  const abs = Math.abs(value)
  if (abs > 0 && abs < 10) return value.toFixed(1).replace(/\.0$/, '')
  return formatTokens(value)
}

function formatCost(c: number): string {
  return `$${c.toFixed(c < 1 ? 4 : 2)}`
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${formatNumber(ms)} ms`
}

function providerLabel(provider: string): string {
  return providerLabels[provider] ?? provider
}

function providerStyle(provider: string) {
  return { '--provider-color': providerColors[provider] ?? '#6366f1' }
}

function logStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    success: '成功',
    rate_limited: '限流',
    error: '错误',
    failed: '失败',
  }
  return labels[status] ?? status
}

function logStatusType(status: string) {
  if (status === 'success') return 'success'
  if (status === 'rate_limited') return 'warning'
  if (status === 'error' || status === 'failed') return 'error'
  return 'default'
}

function latencyLabel(ms: number | null): string {
  return ms == null ? '-' : `${ms}ms`
}

function logTokens(row: DashboardRecentLog): number {
  return row.inputTokens + row.outputTokens + row.cacheCreateTokens + row.cacheReadTokens
}

function logCacheTokens(row: DashboardRecentLog): number {
  return row.cacheCreateTokens + row.cacheReadTokens
}

function hasCacheTokens(row: DashboardRecentLog): boolean {
  return logCacheTokens(row) > 0
}

function formatLogCost(cost: number): string {
  return `$${cost.toFixed(6)}`
}

function formatTokenPrice(price: number | null): string {
  if (price == null) return '—'
  return `$${price.toFixed(price < 1 ? 4 : 2)} / 1M Token`
}

function costMultiplier(row: DashboardRecentLog): string {
  if (!row.baseCost || row.baseCost <= 0) return '1x'
  const multiplier = row.cost / row.baseCost
  return `${multiplier.toFixed(multiplier < 0.01 ? 4 : 3).replace(/0+$/, '').replace(/\.$/, '')}x`
}

function billingLabel(row: DashboardRecentLog): string {
  if (row.billTo === 'subscription') return 'Subscription'
  return 'Balance'
}

function costBreakdown(row: DashboardRecentLog): { label: string; value: string; tone?: string }[] {
  const rows = [
    { label: '输入费用', value: formatLogCost(row.inputCost) },
    { label: '输出费用', value: formatLogCost(row.outputCost) },
  ]
  if (row.cacheCreateCost > 0) rows.push({ label: '缓存写入费用', value: formatLogCost(row.cacheCreateCost) })
  if (row.cacheReadCost > 0) rows.push({ label: '缓存读取费用', value: formatLogCost(row.cacheReadCost) })
  return rows
}

function tokenBreakdown(row: DashboardRecentLog): { label: string; value: number }[] {
  return [
    { label: '输入', value: row.inputTokens },
    { label: '输出', value: row.outputTokens },
    { label: '缓存创建', value: row.cacheCreateTokens },
    { label: '缓存读取', value: row.cacheReadTokens },
  ]
}

function openRequestInput(row: DashboardRecentLog) {
  selectedLog.value = row
}
</script>

<template>
  <div class="grid gap-4">
    <UiGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <UiGi v-for="card in cards" :key="card.label" span="4 s:2 m:1">
        <UiCard class="surface-card relative overflow-hidden min-h-[132px]" :bordered="false">
          <div
            class="absolute -right-7 -top-7 h-24 w-24 rounded-full opacity-15"
            :style="{ background: toneColors[card.tone].blob }"
            aria-hidden="true"
          />
          <div class="relative z-[1] flex items-center gap-4 min-h-[92px]">
            <div
              class="grid place-items-center shrink-0 w-14 h-14 rounded-[14px]"
              :style="{ color: toneColors[card.tone].icon, background: toneColors[card.tone].iconBg }"
              aria-hidden="true"
            >
              <svg
                class="w-7 h-7"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.35"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path v-for="path in statIconPaths[card.icon]" :key="path" :d="path" />
              </svg>
            </div>
            <div class="min-w-0">
              <div class="text-accent-900/60 text-[13px] font-[760]">{{ card.label }}</div>
              <div class="overflow-hidden text-accent-900 text-[clamp(26px,2.2vw,34px)] font-[820] leading-[1.05] truncate mt-1.5 mb-0.5">{{ loading ? '—' : card.value }}</div>
              <div class="truncate text-accent-900/40 text-xs">{{ card.hint }}</div>
            </div>
          </div>
        </UiCard>
      </UiGi>
    </UiGrid>

    <UiGrid :cols="12" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <UiGi span="12 l:8">
        <UiCard class="surface-card h-full" :bordered="false">
          <div class="flex items-start justify-between gap-3.5 mb-4 max-md:flex-col max-md:items-start">
            <div>
              <h3 class="text-accent-900 text-base font-[820] m-0">流量趋势</h3>
              <span class="block mt-1 text-accent-900/45 text-xs">近 14 天请求与 Token 走势</span>
            </div>
            <UiButton size="small" quaternary @click="load">刷新</UiButton>
          </div>
          <EChart :option="dailyOption" height="282px" />
        </UiCard>
      </UiGi>

      <UiGi span="12 l:4">
        <UiCard class="surface-card h-full" :bordered="false">
          <div class="flex items-start justify-between gap-3.5 mb-4 max-md:flex-col max-md:items-start">
            <div>
              <h3 class="text-accent-900 text-base font-[820] m-0">服务商占比</h3>
              <span class="block mt-1 text-accent-900/45 text-xs">按近 30 天 Tokens 统计</span>
            </div>
          </div>
          <EChart v-if="providerRows.length" :option="providerOption" height="218px" />
          <div v-else class="grid place-items-center min-h-[150px] border border-dashed border-accent-900/15 rounded-[14px] text-accent-900/40 bg-accent-50 text-[13px]">暂无用量数据</div>
          <div class="grid gap-2.5 mt-1">
            <div
              v-for="row in providerRows"
              :key="row.provider"
              class="flex items-center justify-between gap-3 px-3 py-2.5 border border-accent-900/7 rounded-xl bg-accent-50"
              :style="providerStyle(row.provider)"
            >
              <span class="flex items-center gap-2 text-accent-900/70 text-[13px] before:content-[''] before:h-2 before:w-2 before:shrink-0 before:rounded-full before:bg-[var(--provider-color)]">{{ providerLabel(row.provider) }}</span>
              <strong class="text-accent-900 text-[13px]">{{ formatNumber(row.tokens) }}</strong>
            </div>
          </div>
        </UiCard>
      </UiGi>
    </UiGrid>

    <UiCard class="surface-card h-full" :bordered="false">
      <div class="flex items-start justify-between gap-3.5 mb-4 max-md:flex-col max-md:items-start">
        <div>
          <h3 class="text-accent-900 text-base font-[820] m-0">使用记录</h3>
          <span class="block mt-1 text-accent-900/45 text-xs">最近调用的 Key、账号、模型、Token、费用和耗时</span>
        </div>
        <div class="flex items-center gap-3 max-md:w-full max-md:justify-between">
          <UiButton size="small" quaternary :loading="recentLoading" @click="loadRecentLogs">刷新</UiButton>
          <router-link class="text-blue-600 text-[13px] font-bold no-underline" to="/stats">详细统计</router-link>
        </div>
      </div>

      <div class="mb-4 grid items-end gap-3 rounded-[14px] border border-accent-900/7 bg-accent-50/80 p-3 md:grid-cols-[minmax(150px,0.75fr)_minmax(180px,1fr)_minmax(180px,1fr)_auto]">
        <label class="grid gap-1.5 text-xs font-[720] text-accent-900/55">
          模型厂商
          <UiSelect
            v-model:value="recentProviderFilter"
            :options="recentProviderOptions"
            clearable
            placeholder="全部厂商"
          />
        </label>
        <label class="grid gap-1.5 text-xs font-[720] text-accent-900/55">
          具体模型
          <UiInput
            v-model:value="recentModelFilter"
            placeholder="输入模型名称"
            @keyup.enter="applyRecentFilters"
          />
        </label>
        <label class="grid gap-1.5 text-xs font-[720] text-accent-900/55">
          Key
          <UiInput
            v-model:value="recentKeyFilter"
            placeholder="输入 Key 名称或前缀"
            @keyup.enter="applyRecentFilters"
          />
        </label>
        <div class="flex items-center justify-end gap-2 max-md:justify-start">
          <UiButton size="small" type="primary" :loading="recentLoading" @click="applyRecentFilters">查询</UiButton>
          <UiButton size="small" quaternary :disabled="!hasRecentFilters" @click="resetRecentFilters">重置</UiButton>
        </div>
      </div>

      <div v-if="recentLogs.length" class="grid gap-2.5 min-w-0">
        <div
          v-for="row in recentLogs"
          :key="row.id"
          class="grid items-center gap-2.5 p-3 border border-accent-900/7 rounded-[14px] bg-white grid-cols-[76px_minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,0.82fr)_minmax(0,0.8fr)_auto] max-xl:grid-cols-[minmax(0,1fr)_auto] max-xl:items-start"
        >
          <div class="flex flex-col items-start gap-[7px] min-w-0">
            <UiTag size="small" :type="logStatusType(row.status)" :bordered="false">
              {{ logStatusLabel(row.status) }}
            </UiTag>
          </div>

          <div class="grid gap-1 min-w-0 max-xl:col-span-full">
            <div class="truncate text-accent-900/50 text-[11px] font-[650]">API Key</div>
            <strong class="truncate text-accent-900 text-[13px] font-[780]">{{ row.apiKeyName || '-' }}</strong>
            <span class="truncate text-accent-900/50 text-xs">{{ row.accountName || '-' }}</span>
          </div>

          <div class="grid gap-1 min-w-0 max-xl:col-span-full" :style="providerStyle(row.provider)">
            <span class="w-fit px-[7px] py-0.5 rounded-full text-[11px] font-extrabold text-[var(--provider-color)] bg-[color-mix(in_srgb,var(--provider-color)_10%,white)]">{{ providerLabel(row.provider) }}</span>
            <strong class="truncate text-accent-900 text-[13px] font-[780]">{{ row.model || '(unknown model)' }}</strong>
          </div>

          <div class="min-w-0 max-xl:col-span-full">
            <div class="flex items-center gap-2 min-w-0 flex-wrap">
              <span class="inline-flex items-center gap-1 min-w-0 text-xs font-[760] whitespace-nowrap text-emerald-600">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
                </svg>
                {{ formatNumber(row.inputTokens) }}
              </span>
              <span class="inline-flex items-center gap-1 min-w-0 text-xs font-[760] whitespace-nowrap text-violet-600">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 19V5m0 0 6 6m-6-6-6 6" />
                </svg>
                {{ formatNumber(row.outputTokens) }}
              </span>
              <UiTooltip trigger="hover" placement="top">
                <template #trigger>
                  <button class="inline-grid w-[18px] h-[18px] p-0 place-items-center border-0 rounded-full text-accent-900/40 bg-accent-900/6 cursor-help hover:text-blue-600 hover:bg-blue-600/12" type="button" aria-label="Token 明细">
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 17v-5" />
                      <path d="M12 8h.01" />
                      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                    </svg>
                  </button>
                </template>
                <div class="grid gap-[5px] min-w-[150px]">
                  <div v-for="item in tokenBreakdown(row)" :key="item.label" class="flex items-center justify-between gap-4 text-xs">
                    <span>{{ item.label }}</span>
                    <strong>{{ formatNumber(item.value) }}</strong>
                  </div>
                  <div class="flex items-center justify-between gap-4 text-xs pt-[5px] border-t border-white/15">
                    <span>总计</span>
                    <strong>{{ formatNumber(logTokens(row)) }}</strong>
                  </div>
                </div>
              </UiTooltip>
            </div>
            <div v-if="hasCacheTokens(row)" class="flex flex-wrap items-center gap-2 min-w-0 mt-1">
              <span v-if="row.cacheReadTokens > 0" class="inline-flex items-center gap-1 min-w-0 text-xs font-[760] whitespace-nowrap text-sky-600">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M5 8h14M5 8a2 2 0 1 1 0-4h14a2 2 0 1 1 0 4M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8m-9 4h4" />
                </svg>
                {{ formatNumber(row.cacheReadTokens) }}
              </span>
              <span v-if="row.cacheCreateTokens > 0" class="inline-flex items-center gap-1 min-w-0 text-xs font-[760] whitespace-nowrap text-amber-600">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
                </svg>
                {{ formatNumber(row.cacheCreateTokens) }}
              </span>
            </div>
            <div v-else class="text-accent-900/50 text-xs">总计 {{ formatNumber(logTokens(row)) }}</div>
          </div>

          <div class="grid gap-1 min-w-0 max-xl:col-span-full">
            <div class="truncate text-accent-900/50 text-[11px] font-[650]">费用</div>
            <div class="flex items-center gap-2 min-w-0">
              <strong class="truncate text-green-600 text-[13px] font-extrabold">{{ formatLogCost(row.cost) }}</strong>
              <UiTooltip trigger="hover" placement="top">
                <template #trigger>
                  <button class="inline-grid w-[18px] h-[18px] p-0 place-items-center border-0 rounded-full text-accent-900/40 bg-accent-900/6 cursor-help hover:text-blue-600 hover:bg-blue-600/12" type="button" aria-label="费用明细">
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M12 17v-5" />
                      <path d="M12 8h.01" />
                      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                    </svg>
                  </button>
                </template>
                <div class="grid gap-[7px] min-w-[260px] text-slate-50">
                  <div class="mb-0.5 text-slate-50 text-sm font-[850]">费用明细</div>
                  <div v-for="item in costBreakdown(row)" :key="item.label" class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>{{ item.label }}</span>
                    <strong class="text-slate-50 font-extrabold whitespace-nowrap">{{ item.value }}</strong>
                  </div>
                  <div class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>输入单价</span>
                    <strong class="text-cyan-300 font-extrabold whitespace-nowrap">{{ formatTokenPrice(row.inputPrice) }}</strong>
                  </div>
                  <div class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>输出单价</span>
                    <strong class="text-cyan-300 font-extrabold whitespace-nowrap">{{ formatTokenPrice(row.outputPrice) }}</strong>
                  </div>
                  <div v-if="row.cacheCreatePrice && row.cacheCreatePrice > 0" class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>缓存写入单价</span>
                    <strong class="text-cyan-300 font-extrabold whitespace-nowrap">{{ formatTokenPrice(row.cacheCreatePrice) }}</strong>
                  </div>
                  <div v-if="row.cacheReadPrice && row.cacheReadPrice > 0" class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>缓存读取单价</span>
                    <strong class="text-cyan-300 font-extrabold whitespace-nowrap">{{ formatTokenPrice(row.cacheReadPrice) }}</strong>
                  </div>
                  <div class="h-px my-[3px] bg-slate-400/30" />
                  <div class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>服务档位</span>
                    <strong class="text-cyan-300 font-extrabold whitespace-nowrap">Standard</strong>
                  </div>
                  <div class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>倍率</span>
                    <strong class="text-blue-400 font-extrabold whitespace-nowrap">{{ costMultiplier(row) }}</strong>
                  </div>
                  <div class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>原始</span>
                    <strong class="text-slate-50 font-extrabold whitespace-nowrap">{{ formatLogCost(row.baseCost) }}</strong>
                  </div>
                  <div class="h-px my-[3px] bg-slate-400/30" />
                  <div class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>预算</span>
                    <strong class="text-slate-50 font-extrabold whitespace-nowrap">{{ billingLabel(row) }}</strong>
                  </div>
                  <div class="flex items-center justify-between gap-[18px] text-xs leading-[1.15] text-slate-400">
                    <span>计费</span>
                    <strong class="text-green-400 text-[13px] font-extrabold whitespace-nowrap">{{ formatLogCost(row.cost) }}</strong>
                  </div>
                </div>
              </UiTooltip>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 max-xl:col-span-full">
            <div class="grid gap-[3px] min-w-0">
              <span class="truncate text-accent-900/50 text-[11px] font-[650]">首 Token</span>
              <strong class="truncate text-accent-900/70 text-xs font-[760]">{{ latencyLabel(row.firstTokenMs) }}</strong>
            </div>
            <div class="grid gap-[3px] min-w-0">
              <span class="truncate text-accent-900/50 text-[11px] font-[650]">耗时</span>
              <strong class="truncate text-accent-900/70 text-xs font-[760]">{{ latencyLabel(row.latencyMs) }}</strong>
            </div>
          </div>

          <div class="grid gap-1 min-w-0 max-xl:col-span-full">
            <div class="truncate text-accent-900/50 text-[11px] font-[650]">时间</div>
            <strong class="truncate text-accent-900 text-[13px] font-[780]">{{ formatTime(row.ts) }}</strong>
          </div>

          <UiButton class="justify-self-end max-xl:col-start-2 max-xl:row-start-1" size="small" secondary @click="openRequestInput(row)">查看</UiButton>
        </div>
        <div class="flex justify-end pt-0.5">
          <UiPagination
            v-model:page="recentPage"
            :page-size="RECENT_PAGE_SIZE"
            :item-count="recentTotal"
            :disabled="recentLoading"
          />
        </div>
      </div>
      <div v-else class="grid place-items-center min-h-[150px] border border-dashed border-accent-900/15 rounded-[14px] text-accent-900/40 bg-accent-50 text-[13px]">{{ recentEmptyText }}</div>
    </UiCard>

    <UiModal
      :show="!!selectedLog"
      title="请求输入"
      width="min(760px, calc(100vw - 32px))"
      @update:show="(shown: boolean) => { if (!shown) selectedLog = null }"
    >
      <UiInput
        :value="selectedLog?.requestInput || '未记录输入内容'"
        type="textarea"
        readonly
        :autosize="{ minRows: 12, maxRows: 22 }"
      />
    </UiModal>
  </div>
</template>
