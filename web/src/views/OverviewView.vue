<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from '../composables/useMessage'
import EChart from '../components/EChart.vue'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

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
}

const providerColors: Record<string, string> = {
  claude: '#d97757',
  openai: '#10a37f',
  gemini: '#4285f4',
  deepseek: '#6366f1',
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
    label: '24h 请求',
    value: formatNumber(totals.value.requests24h),
    hint: `累计 ${formatNumber(totals.value.requestCount)} 次`,
    tone: 'violet',
    icon: 'chart',
  },
  {
    label: '用户',
    value: formatNumber(totals.value.totalUsers),
    hint: `24h 新增 ${formatNumber(totals.value.newUsers24h)} · 活跃 ${formatNumber(totals.value.activeUsers24h)}`,
    tone: 'cyan',
    icon: 'users',
  },
  {
    label: '24h Tokens',
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
        ? '暂无 24h 请求'
        : `24h 成功率 ${successRate24h.value.toFixed(1)}%`,
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
    const { data } = await api.get<DashboardRecentLogsPage>('/admin/overview/recent-logs', {
      params: { page: recentPage.value, pageSize: RECENT_PAGE_SIZE },
    })
    recentLogs.value = data.logs
    recentTotal.value = data.total
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    recentLoading.value = false
  }
}

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

function formatTokens(n: number): string {
  const value = Number.isFinite(n) ? n : 0
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return Math.round(value).toLocaleString('en-US')
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
  <div class="dashboard-page">
    <UiGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <UiGi v-for="card in cards" :key="card.label" span="4 s:2 m:1">
        <UiCard class="stat-card surface-card" :class="`is-${card.tone}`" :bordered="false">
          <div class="stat-content">
            <div class="stat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  v-for="path in statIconPaths[card.icon]"
                  :key="path"
                  :d="path"
                  stroke="currentColor"
                  stroke-width="2.35"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
            <div class="stat-copy">
              <div class="stat-label">{{ card.label }}</div>
              <div class="stat-value">{{ loading ? '—' : card.value }}</div>
              <div class="stat-hint">{{ card.hint }}</div>
            </div>
          </div>
        </UiCard>
      </UiGi>
    </UiGrid>

    <UiGrid :cols="12" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <UiGi span="12 l:8">
        <UiCard class="surface-card panel-card" :bordered="false">
          <div class="panel-head">
            <div>
              <h3>流量趋势</h3>
              <span>近 14 天请求与 Token 走势</span>
            </div>
            <UiButton size="small" quaternary @click="load">刷新</UiButton>
          </div>
          <EChart :option="dailyOption" height="282px" />
        </UiCard>
      </UiGi>

      <UiGi span="12 l:4">
        <UiCard class="surface-card panel-card" :bordered="false">
          <div class="panel-head">
            <div>
              <h3>服务商占比</h3>
              <span>按近 30 天 Tokens 统计</span>
            </div>
          </div>
          <EChart v-if="providerRows.length" :option="providerOption" height="218px" />
          <div v-else class="empty-state">暂无用量数据</div>
          <div class="provider-list">
            <div
              v-for="row in providerRows"
              :key="row.provider"
              class="provider-row"
              :style="providerStyle(row.provider)"
            >
              <span>{{ providerLabel(row.provider) }}</span>
              <strong>{{ formatNumber(row.tokens) }}</strong>
            </div>
          </div>
        </UiCard>
      </UiGi>
    </UiGrid>

    <UiCard class="surface-card panel-card" :bordered="false">
      <div class="panel-head">
        <div>
          <h3>使用记录</h3>
          <span>最近调用的 Key、账号、模型、Token、费用和耗时</span>
        </div>
        <div class="panel-actions">
          <UiButton size="small" quaternary :loading="recentLoading" @click="loadRecentLogs">刷新</UiButton>
          <router-link class="panel-link" to="/stats">详细统计</router-link>
        </div>
      </div>

      <div v-if="recentLogs.length" class="log-list">
        <div v-for="row in recentLogs" :key="row.id" class="log-row">
          <div class="log-status-cell">
            <UiTag class="log-status" size="small" :type="logStatusType(row.status)" :bordered="false">
              {{ logStatusLabel(row.status) }}
            </UiTag>
            <span class="request-type-badge">API</span>
          </div>

          <div class="log-identity-cell">
            <div class="log-cell-label">API Key</div>
            <strong>{{ row.apiKeyName || '-' }}</strong>
            <span>账号 {{ row.accountName || '-' }}</span>
          </div>

          <div class="log-model-cell" :style="providerStyle(row.provider)">
            <span class="provider-chip compact">{{ providerLabel(row.provider) }}</span>
            <strong>{{ row.model || '(unknown model)' }}</strong>
          </div>

          <div class="log-token-cell">
            <div class="token-main-line">
              <span class="token-chip token-input">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
                </svg>
                {{ formatNumber(row.inputTokens) }}
              </span>
              <span class="token-chip token-output">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 19V5m0 0 6 6m-6-6-6 6" />
                </svg>
                {{ formatNumber(row.outputTokens) }}
              </span>
              <UiTooltip trigger="hover" placement="top">
                <template #trigger>
                  <button class="info-button" type="button" aria-label="Token 明细">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 17v-5" />
                      <path d="M12 8h.01" />
                      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                    </svg>
                  </button>
                </template>
                <div class="token-breakdown">
                  <div v-for="item in tokenBreakdown(row)" :key="item.label" class="token-breakdown-row">
                    <span>{{ item.label }}</span>
                    <strong>{{ formatNumber(item.value) }}</strong>
                  </div>
                  <div class="token-breakdown-row total">
                    <span>总计</span>
                    <strong>{{ formatNumber(logTokens(row)) }}</strong>
                  </div>
                </div>
              </UiTooltip>
            </div>
            <div v-if="hasCacheTokens(row)" class="token-cache-line">
              <span v-if="row.cacheReadTokens > 0" class="token-cache read">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 8h14M5 8a2 2 0 1 1 0-4h14a2 2 0 1 1 0 4M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8m-9 4h4" />
                </svg>
                {{ formatNumber(row.cacheReadTokens) }}
              </span>
              <span v-if="row.cacheCreateTokens > 0" class="token-cache create">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
                </svg>
                {{ formatNumber(row.cacheCreateTokens) }}
              </span>
            </div>
            <div v-else class="log-subtle">总计 {{ formatNumber(logTokens(row)) }}</div>
          </div>

          <div class="log-cost-cell">
            <div class="log-cell-label">费用</div>
            <div class="cost-line">
              <strong>{{ formatLogCost(row.cost) }}</strong>
              <UiTooltip trigger="hover" placement="top">
                <template #trigger>
                  <button class="info-button" type="button" aria-label="费用明细">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 17v-5" />
                      <path d="M12 8h.01" />
                      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
                    </svg>
                  </button>
                </template>
                <div class="cost-breakdown">
                  <div class="cost-breakdown-title">费用明细</div>
                  <div v-for="item in costBreakdown(row)" :key="item.label" class="cost-breakdown-row">
                    <span>{{ item.label }}</span>
                    <strong>{{ item.value }}</strong>
                  </div>
                  <div class="cost-breakdown-row price">
                    <span>输入单价</span>
                    <strong>{{ formatTokenPrice(row.inputPrice) }}</strong>
                  </div>
                  <div class="cost-breakdown-row price">
                    <span>输出单价</span>
                    <strong>{{ formatTokenPrice(row.outputPrice) }}</strong>
                  </div>
                  <div v-if="row.cacheCreatePrice && row.cacheCreatePrice > 0" class="cost-breakdown-row price">
                    <span>缓存写入单价</span>
                    <strong>{{ formatTokenPrice(row.cacheCreatePrice) }}</strong>
                  </div>
                  <div v-if="row.cacheReadPrice && row.cacheReadPrice > 0" class="cost-breakdown-row price">
                    <span>缓存读取单价</span>
                    <strong>{{ formatTokenPrice(row.cacheReadPrice) }}</strong>
                  </div>
                  <div class="cost-breakdown-divider" />
                  <div class="cost-breakdown-row">
                    <span>服务档位</span>
                    <strong class="accent-cyan">Standard</strong>
                  </div>
                  <div class="cost-breakdown-row">
                    <span>倍率</span>
                    <strong class="accent-blue">{{ costMultiplier(row) }}</strong>
                  </div>
                  <div class="cost-breakdown-row">
                    <span>原始</span>
                    <strong>{{ formatLogCost(row.baseCost) }}</strong>
                  </div>
                  <div class="cost-breakdown-divider" />
                  <div class="cost-breakdown-row">
                    <span>预算</span>
                    <strong>{{ billingLabel(row) }}</strong>
                  </div>
                  <div class="cost-breakdown-row total">
                    <span>计费</span>
                    <strong>{{ formatLogCost(row.cost) }}</strong>
                  </div>
                </div>
              </UiTooltip>
            </div>
          </div>

          <div class="log-duration-cell">
            <div>
              <span>首 Token</span>
              <strong>{{ latencyLabel(row.firstTokenMs) }}</strong>
            </div>
            <div>
              <span>耗时</span>
              <strong>{{ latencyLabel(row.latencyMs) }}</strong>
            </div>
          </div>

          <div class="log-time-cell">
            <div class="log-cell-label">时间</div>
            <strong>{{ formatTime(row.ts) }}</strong>
          </div>

          <UiButton class="log-action" size="small" secondary @click="openRequestInput(row)">查看</UiButton>
        </div>
        <div class="log-pagination">
          <UiPagination
            v-model:page="recentPage"
            :page-size="RECENT_PAGE_SIZE"
            :item-count="recentTotal"
            :disabled="recentLoading"
          />
        </div>
      </div>
      <div v-else class="empty-state">{{ recentLoading ? '加载中...' : '暂无请求记录' }}</div>
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

<style scoped>
.dashboard-page {
  display: grid;
  gap: 16px;
}

.stat-card {
  position: relative;
  min-height: 132px;
  overflow: hidden;
}

.stat-card::after {
  content: '';
  position: absolute;
  width: 96px;
  height: 96px;
  right: -28px;
  top: -28px;
  border-radius: 999px;
  opacity: 0.15;
}

.stat-card.is-green::after {
  background: #14b8a6;
}

.stat-card.is-blue::after {
  background: #2563eb;
}

.stat-card.is-violet::after {
  background: #8b5cf6;
}

.stat-card.is-amber::after {
  background: #f59e0b;
}

.stat-card.is-teal::after {
  background: #0d9488;
}

.stat-card.is-cyan::after {
  background: #06b6d4;
}

.stat-card.is-indigo::after {
  background: #6366f1;
}

.stat-card.is-rose::after {
  background: #f43f5e;
}

.stat-content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 92px;
}

.stat-icon {
  display: grid;
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  place-items: center;
  border-radius: 14px;
}

.stat-icon svg {
  width: 28px;
  height: 28px;
}

.stat-copy {
  min-width: 0;
}

.stat-label {
  color: rgba(15, 23, 42, 0.58);
  font-size: 13px;
  font-weight: 760;
}

.stat-value {
  margin: 6px 0 2px;
  overflow: hidden;
  color: #0f172a;
  font-size: clamp(26px, 2.2vw, 34px);
  font-weight: 820;
  line-height: 1.05;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-hint {
  overflow: hidden;
  color: rgba(15, 23, 42, 0.42);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-card.is-green .stat-icon {
  color: #0d9488;
  background: rgba(20, 184, 166, 0.14);
}

.stat-card.is-blue .stat-icon {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.13);
}

.stat-card.is-violet .stat-icon {
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.14);
}

.stat-card.is-amber .stat-icon {
  color: #d97706;
  background: rgba(245, 158, 11, 0.17);
}

.stat-card.is-teal .stat-icon {
  color: #0d9488;
  background: rgba(13, 148, 136, 0.14);
}

.stat-card.is-cyan .stat-icon {
  color: #0891b2;
  background: rgba(6, 182, 212, 0.14);
}

.stat-card.is-indigo .stat-icon {
  color: #4f46e5;
  background: rgba(99, 102, 241, 0.15);
}

.stat-card.is-rose .stat-icon {
  color: #e11d48;
  background: rgba(244, 63, 94, 0.14);
}

.panel-card {
  height: 100%;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 16px;
}

.panel-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 820;
}

.panel-head span {
  display: block;
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.46);
  font-size: 12px;
}

.panel-link {
  color: #2563eb;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.provider-list,
.account-list,
.key-list,
.log-list {
  display: grid;
  gap: 10px;
}

.provider-list {
  margin-top: 4px;
}

.provider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 12px;
  background: #f8fafc;
}

.provider-row span {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(15, 23, 42, 0.68);
  font-size: 13px;
}

.provider-row span::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--provider-color);
}

.provider-row strong {
  color: #0f172a;
  font-size: 13px;
}

.account-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
}

.account-main {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.account-main strong,
.key-head strong {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 780;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-main small,
.key-head span,
.key-foot,
.log-subtle {
  color: rgba(15, 23, 42, 0.48);
  font-size: 12px;
}

.provider-chip {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 999px;
  color: var(--provider-color);
  background: color-mix(in srgb, var(--provider-color) 10%, white);
  font-size: 11px;
  font-weight: 800;
}

.provider-chip.compact {
  padding: 2px 7px;
}

.key-row {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.key-head,
.key-foot {
  display: flex;
  align-items: center;
}

.key-head,
.key-foot {
  justify-content: space-between;
  gap: 12px;
}

.key-head > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.log-list {
  min-width: 0;
}

.log-row {
  display: grid;
  grid-template-columns:
    76px minmax(0, 0.95fr) minmax(0, 1.05fr) minmax(0, 1.2fr)
    minmax(0, 0.8fr) minmax(0, 0.82fr) minmax(0, 0.8fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 14px;
  background: #ffffff;
}

.log-status-cell,
.log-identity-cell,
.log-model-cell,
.log-token-cell,
.log-cost-cell,
.log-time-cell {
  min-width: 0;
}

.log-status-cell {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 7px;
}

.request-type-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 2px 8px;
  border-radius: 999px;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  font-size: 11px;
  font-weight: 780;
}

.log-cell-label,
.log-duration-cell span,
.log-cost-cell > span {
  overflow: hidden;
  color: rgba(15, 23, 42, 0.48);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-identity-cell,
.log-model-cell,
.log-cost-cell,
.log-time-cell {
  display: grid;
  gap: 4px;
}

.log-identity-cell strong,
.log-model-cell strong,
.log-time-cell strong {
  overflow: hidden;
  color: #0f172a;
  font-size: 13px;
  font-weight: 780;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-identity-cell span {
  overflow: hidden;
  color: rgba(15, 23, 42, 0.48);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.token-main-line,
.token-cache-line,
.cost-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.token-main-line {
  flex-wrap: wrap;
}

.token-chip,
.token-cache {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
  font-weight: 760;
  white-space: nowrap;
}

.token-chip svg,
.token-cache svg,
.info-button svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.token-input {
  color: #059669;
}

.token-output {
  color: #7c3aed;
}

.token-cache-line {
  flex-wrap: wrap;
  margin-top: 4px;
}

.token-cache.read {
  color: #0284c7;
}

.token-cache.create {
  color: #d97706;
}

.info-button {
  display: inline-grid;
  width: 18px;
  height: 18px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 999px;
  color: rgba(15, 23, 42, 0.42);
  background: rgba(15, 23, 42, 0.06);
  cursor: help;
}

.info-button:hover {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
}

.cost-line strong {
  overflow: hidden;
  color: #16a34a;
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-duration-cell {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.log-duration-cell div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.log-duration-cell strong {
  overflow: hidden;
  color: rgba(15, 23, 42, 0.7);
  font-size: 12px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-action {
  justify-self: end;
}

.token-breakdown {
  display: grid;
  gap: 5px;
  min-width: 150px;
}

.token-breakdown-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
}

.token-breakdown-row.total {
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.cost-breakdown {
  display: grid;
  gap: 7px;
  min-width: 260px;
  color: #f8fafc;
}

.cost-breakdown-title {
  margin-bottom: 2px;
  color: #f8fafc;
  font-size: 14px;
  font-weight: 850;
}

.cost-breakdown-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.15;
}

.cost-breakdown-row strong {
  color: #f8fafc;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.cost-breakdown-row.price strong {
  color: #67e8f9;
}

.cost-breakdown-row.total strong {
  color: #4ade80;
  font-size: 13px;
}

.cost-breakdown-row .accent-cyan {
  color: #67e8f9;
}

.cost-breakdown-row .accent-blue {
  color: #60a5fa;
}

.cost-breakdown-divider {
  height: 1px;
  margin: 3px 0;
  background: rgba(148, 163, 184, 0.28);
}

.log-pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

.empty-state {
  display: grid;
  min-height: 150px;
  place-items: center;
  border: 1px dashed rgba(15, 23, 42, 0.13);
  border-radius: 14px;
  color: rgba(15, 23, 42, 0.42);
  background: #f8fafc;
  font-size: 13px;
}

@media (max-width: 1279px) {
  .log-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: flex-start;
  }

  .log-status-cell {
    grid-column: 1;
  }

  .log-action {
    grid-column: 2;
    grid-row: 1;
  }

  .log-identity-cell,
  .log-model-cell,
  .log-token-cell,
  .log-cost-cell,
  .log-duration-cell,
  .log-time-cell {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .key-head,
  .key-foot {
    align-items: flex-start;
    flex-direction: column;
  }

  .panel-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .panel-actions {
    justify-content: space-between;
    width: 100%;
  }
}
</style>
