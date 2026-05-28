<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
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
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
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
    requestCount: number
    requests24h: number
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
  requestCount: 0,
  requests24h: 0,
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

const totals = computed(() => dashboard.value?.totals ?? emptyTotals)
const providerRows = computed(() => dashboard.value?.byProvider ?? [])

const cards = computed(() => [
  {
    label: '可用账户',
    value: `${totals.value.activeAccountCount}/${totals.value.accountCount}`,
    hint: `${totals.value.coolingAccountCount} 个冷却 · ${totals.value.disabledAccountCount} 个禁用`,
    tone: 'green',
  },
  {
    label: 'API Keys',
    value: `${totals.value.enabledKeyCount}/${totals.value.keyCount}`,
    hint: '启用 / 全部',
    tone: 'blue',
  },
  {
    label: '24h 请求',
    value: formatNumber(totals.value.requests24h),
    hint: `累计 ${formatNumber(totals.value.requestCount)} 次`,
    tone: 'violet',
  },
  {
    label: '30天成本',
    value: formatCost(totals.value.cost30d),
    hint: `${formatNumber(totals.value.tokens30d)} tokens`,
    tone: 'amber',
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

function formatCost(c: number): string {
  return `$${c.toFixed(c < 1 ? 4 : 2)}`
}

function providerLabel(provider: string): string {
  return providerLabels[provider] ?? provider
}

function providerStyle(provider: string) {
  return { '--provider-color': providerColors[provider] ?? '#6366f1' }
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

function openRequestInput(row: DashboardRecentLog) {
  selectedLog.value = row
}
</script>

<template>
  <div class="dashboard-page">
    <n-grid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <n-gi v-for="card in cards" :key="card.label" span="4 s:2 m:1">
        <n-card class="stat-card surface-card" :class="`is-${card.tone}`" :bordered="false">
          <div class="stat-label">{{ card.label }}</div>
          <div class="stat-value">{{ loading ? '—' : card.value }}</div>
          <div class="stat-hint">{{ card.hint }}</div>
        </n-card>
      </n-gi>
    </n-grid>

    <n-grid :cols="12" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <n-gi span="12 l:8">
        <n-card class="surface-card panel-card" :bordered="false">
          <div class="panel-head">
            <div>
              <h3>流量趋势</h3>
              <span>近 14 天请求与 Token 走势</span>
            </div>
            <n-button size="small" quaternary @click="load">刷新</n-button>
          </div>
          <EChart :option="dailyOption" height="282px" />
        </n-card>
      </n-gi>

      <n-gi span="12 l:4">
        <n-card class="surface-card panel-card" :bordered="false">
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
        </n-card>
      </n-gi>
    </n-grid>

    <n-card class="surface-card panel-card" :bordered="false">
      <div class="panel-head">
        <div>
          <h3>最近调用</h3>
          <span>快速查看入口、模型、耗时和状态</span>
        </div>
        <div class="panel-actions">
          <n-button size="small" quaternary :loading="recentLoading" @click="loadRecentLogs">刷新</n-button>
          <router-link class="panel-link" to="/stats">详细统计</router-link>
        </div>
      </div>

      <div v-if="recentLogs.length" class="log-list">
        <div v-for="row in recentLogs" :key="row.id" class="log-row">
          <n-tag class="log-status" size="small" :type="logStatusType(row.status)" :bordered="false">
            {{ row.status }}
          </n-tag>
          <div class="log-model">
            <strong>{{ row.model || '(unknown model)' }}</strong>
            <span>{{ providerLabel(row.provider) }} · {{ row.accountName || '未知账号' }} · {{ row.apiKeyName || '未知 Key' }}</span>
          </div>
          <div class="log-metric">
            <span>输入</span>
            <strong>{{ formatNumber(row.inputTokens) }}</strong>
          </div>
          <div class="log-metric">
            <span>输出</span>
            <strong>{{ formatNumber(row.outputTokens) }}</strong>
          </div>
          <div class="log-metric">
            <span>总计</span>
            <strong>{{ formatNumber(logTokens(row)) }}</strong>
          </div>
          <div class="log-metric">
            <span>耗时</span>
            <strong>{{ latencyLabel(row.latencyMs) }}</strong>
          </div>
          <div class="log-metric">
            <span>成本</span>
            <strong>{{ formatCost(row.cost) }}</strong>
          </div>
          <div class="log-time">{{ formatTime(row.ts) }}</div>
          <n-button size="small" secondary @click="openRequestInput(row)">查看</n-button>
        </div>
        <div class="log-pagination">
          <n-pagination
            v-model:page="recentPage"
            :page-size="RECENT_PAGE_SIZE"
            :item-count="recentTotal"
            :disabled="recentLoading"
          />
        </div>
      </div>
      <div v-else class="empty-state">{{ recentLoading ? '加载中...' : '暂无请求记录' }}</div>
    </n-card>

    <n-modal
      :show="!!selectedLog"
      preset="card"
      title="请求输入"
      style="width: min(760px, calc(100vw - 32px))"
      @update:show="(shown: boolean) => { if (!shown) selectedLog = null }"
    >
      <n-input
        :value="selectedLog?.requestInput || '未记录输入内容'"
        type="textarea"
        readonly
        :autosize="{ minRows: 12, maxRows: 22 }"
      />
    </n-modal>
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

.stat-label {
  color: rgba(15, 23, 42, 0.58);
  font-size: 13px;
}

.stat-value {
  margin: 8px 0 2px;
  color: #0f172a;
  font-size: 34px;
  font-weight: 820;
}

.stat-hint {
  color: rgba(15, 23, 42, 0.42);
  font-size: 12px;
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

.log-row {
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 14px;
  background: #ffffff;
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
.key-head strong,
.log-model strong {
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
.log-model span,
.log-meta {
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

.key-row {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.key-head,
.key-foot,
.log-top,
.log-main,
.log-meta {
  display: flex;
  align-items: center;
}

.key-head,
.key-foot,
.log-top {
  justify-content: space-between;
  gap: 12px;
}

.key-head > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.log-row {
  display: grid;
  grid-template-columns: 88px minmax(180px, 1.4fr) repeat(5, minmax(72px, 0.6fr)) minmax(138px, 0.9fr) 64px;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.log-status {
  justify-self: start;
}

.log-model {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.log-metric {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.log-metric span,
.log-time {
  color: rgba(15, 23, 42, 0.46);
  font-size: 11px;
}

.log-metric strong,
.log-time {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-metric strong {
  color: #0f172a;
  font-size: 12px;
  font-weight: 760;
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

@media (max-width: 720px) {
  .key-head,
  .key-foot {
    align-items: flex-start;
    flex-direction: column;
  }

  .log-row {
    grid-template-columns: minmax(0, 1fr) 64px;
  }

  .log-status,
  .log-model,
  .log-metric,
  .log-time {
    grid-column: 1;
  }
}
</style>
