<script setup lang="ts">
import { usageSourceLabel } from '../usageSource'
import { h, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { UiTag, UiTooltip } from '../components/ui'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { calendarDayRangeMs, formatTime, formatUsd } from '../utils'
import { formatSubscriptionUsage } from '../billing'

interface UsageLog {
  subscriptionPoints: number | null
  usageSource?: string
  id: string
  ts: number
  provider: string
  model: string | null
  status: string
  errorCategory: string | null
  modelMismatch: boolean
  latencyMs: number | null
  firstTokenMs: number | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  imageInputTokens: number
  imageOutputTokens: number
  imageCacheReadTokens: number
  imageCount: number
  videoSeconds: number
  videoResolution: string | null
  cost: number
  apiKeyName: string | null
}

interface WalletTransaction {
  id: string
  type: string
  amount: number
  balanceAfter: number
  usageLogId: string | null
  note: string | null
  createdBy: string | null
  createdAt: number
}

const message = useMessage()
const route = useRoute()
const activeTab = ref(route.query.tab === 'wallet' ? 'wallet' : 'usage')
const usageLoading = ref(true)
const walletLoading = ref(true)
const usageRows = ref<UsageLog[]>([])
const walletRows = ref<WalletTransaction[]>([])
const usagePage = ref(1), walletPage = ref(1)
const usageTotal = ref(0), walletTotal = ref(0)
const pageSize = 20
let usageVersion = 0, walletVersion = 0
const duration = (value: number | null) => value == null ? '—' : `${(value / 1000).toFixed(1)} 秒`
const walletType = (type: string) => ({ usage: '调用扣费', credit: '充值入账', debit: '余额扣款', refund: '退款', redeem: '兑换入账', subscription: '套餐购买' } as Record<string, string>)[type] ?? type
const walletNote = (note: string | null) => note === 'usage charge' ? '调用扣费' : note || '—'

function usageLabel(row: UsageLog) {
  if (row.videoSeconds > 0) return `${row.videoSeconds} 秒 · ${row.videoResolution || '视频'}`
  if (row.imageCount > 0) return `${row.imageCount} 张`
  const total = row.inputTokens + row.outputTokens + row.cacheCreateTokens + row.cacheReadTokens + (row.imageInputTokens ?? 0) + (row.imageOutputTokens ?? 0) + (row.imageCacheReadTokens ?? 0)
  return total > 0 || row.status === 'success' ? `${total.toLocaleString()} Tokens` : '未记录用量'
}

// Date filter — stored as "YYYY-MM-DD" strings for the native date inputs,
// converted to epoch-ms range when calling the API.
function dayFromQuery(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : ''
}

const dateFrom = ref(dayFromQuery(route.query.from))
const dateEnd = ref(dayFromQuery(route.query.to))
const failureOnly = ref(route.query.status === 'error')

const datePresets = [
  { label: '全部', value: null as null | [string, string] },
  { label: '今天', value: [todayStr(), todayStr()] as [string, string] },
  { label: '近7天', value: [daysAgoStr(6), todayStr()] as [string, string] },
  { label: '近30天', value: [daysAgoStr(29), todayStr()] as [string, string] }
]

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function pad2(v: number) {
  return String(v).padStart(2, '0')
}

function applyPreset(preset: (typeof datePresets)[number]) {
  if (preset.value) {
    dateFrom.value = preset.value[0]
    dateEnd.value = preset.value[1]
  } else {
    dateFrom.value = ''
    dateEnd.value = ''
  }
}

// Reload when date range changes
watch([dateFrom, dateEnd, failureOnly], () => {
  if (usagePage.value === 1) void loadUsage()
  else usagePage.value = 1
})
watch(usagePage, loadUsage)
watch(walletPage, loadWallet)

function totalTokens(row: UsageLog) {
  if (row.videoSeconds > 0 || (row.imageCount > 0 && !(row.inputTokens + row.outputTokens + row.cacheReadTokens + row.imageOutputTokens))) return h('span', { class: 'token-total' }, row.videoSeconds > 0 ? `${row.videoSeconds} 秒 · ${row.videoResolution}` : `${row.imageCount ?? 0} 张`)
  const total = row.inputTokens + row.outputTokens + row.cacheCreateTokens + row.cacheReadTokens + (row.imageInputTokens ?? 0) + (row.imageOutputTokens ?? 0) + (row.imageCacheReadTokens ?? 0)
  const rows: [string, number][] = [
    ['输入', row.inputTokens],
    ['输出', row.outputTokens],
    ...(row.reasoningTokens > 0 ? [['推理', row.reasoningTokens] as [string, number]] : []),
    ['缓存写入', row.cacheCreateTokens],
    ['缓存读取', row.cacheReadTokens],
    ['图片输入', row.imageInputTokens ?? 0],
    ['图片输出', row.imageOutputTokens ?? 0],
    ['图片缓存', row.imageCacheReadTokens ?? 0]
  ]
  return h(
    UiTooltip,
    { placement: 'left', trigger: 'hover' },
    {
      trigger: () => h('span', { class: 'token-total' }, total.toLocaleString('en-US')),
      default: () =>
        h(
          'div',
          { class: 'token-breakdown' },
          rows.map(([label, value]) => h('div', { class: 'token-breakdown-row' }, [h('span', { class: 'token-breakdown-label' }, label), h('span', { class: 'token-breakdown-value' }, value.toLocaleString('en-US'))]))
        )
    }
  )
}

async function loadUsage() {
  const version = ++usageVersion
  usageLoading.value = true
  try {
    const params: Record<string, unknown> = { page: usagePage.value, pageSize }
    if (dateFrom.value) params.startDate = calendarDayRangeMs(dateFrom.value)[0]
    if (dateEnd.value) params.endDate = calendarDayRangeMs(dateEnd.value)[1]
    if (failureOnly.value) params.status = 'error'
    const usageRes = await api.get('/users/usage', { params })
    if (version !== usageVersion) return
    usageRows.value = usageRes.data.logs
    usageTotal.value = usageRes.data.total
  } catch (e) {
    if (version === usageVersion) message.error(errMsg(e))
  } finally {
    if (version === usageVersion) usageLoading.value = false
  }
}

async function loadWallet() {
  const version = ++walletVersion
  walletLoading.value = true
  try {
    const walletRes = await api.get('/users/wallet/transactions', { params: { page: walletPage.value, pageSize } })
    if (version !== walletVersion) return
    walletRows.value = walletRes.data.transactions
    walletTotal.value = walletRes.data.total
  } catch (e) {
    if (version === walletVersion) message.error(errMsg(e))
  } finally {
    if (version === walletVersion) walletLoading.value = false
  }
}

const usageColumns: TableColumn<UsageLog>[] = [
  {
    title: '时间',
    key: 'ts',
    minWidth: 150,
    render: (row) => formatTime(row.ts)
  },
  {
    title: 'Key',
    key: 'apiKeyName',
    minWidth: 130,
    render: (row) => row.apiKeyName || '—'
  },
  { title: '服务商', key: 'provider', width: 110, render: row => row.provider === 'modelbridge' ? 'Model Bridge' : row.provider },
  {
    title: '模型',
    key: 'model',
    minWidth: 180,
    render: (row) => row.model || '—'
  },
  { title: '用量来源', key: 'usageSource', width: 125, render: row => h(UiTag,
    { size: 'small', bordered: false, type: row.usageSource === 'missing' || row.usageSource === 'partial' ? 'warning' : 'default' },
    { default: () => usageSourceLabel(row.usageSource) }) },
  { title: '用量', key: 'tokens', width: 110, render: totalTokens },
  {
    title: '消耗',
    key: 'cost',
    width: 125,
    render: (row) => row.subscriptionPoints != null ? formatSubscriptionUsage(row.subscriptionPoints) : formatUsd(row.cost)
  },
  {
    title: '首字',
    key: 'firstTokenMs',
    width: 90,
    render: (row) => duration(row.firstTokenMs)
  },
  {
    title: '延迟',
    key: 'latencyMs',
    width: 90,
    render: (row) => duration(row.latencyMs)
  },
  {
    title: '状态',
    key: 'status',
    minWidth: 130,
    render: (row) =>
      h('div', { class: 'status-cell' }, [
        h(
          UiTag,
          {
            size: 'small',
            bordered: false,
            type: row.status === 'success' ? 'success' : 'error'
          },
          { default: () => row.status === 'success' ? '成功' : '失败' }
        ),
        row.status !== 'success' && row.errorCategory ? h('span', null, row.errorCategory) : null,
        row.modelMismatch ? h(UiTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '模型异常' }) : null
      ])
  }
]

const walletColumns: TableColumn<WalletTransaction>[] = [
  {
    title: '时间',
    key: 'createdAt',
    minWidth: 150,
    render: (row) => formatTime(row.createdAt)
  },
  { title: '类型', key: 'type', width: 90, render: row => walletType(row.type) },
  {
    title: '金额',
    key: 'amount',
    width: 110,
    render: (row) => h('span', { class: row.amount < 0 ? 'danger' : 'amount' }, formatUsd(row.amount))
  },
  {
    title: '余额',
    key: 'balanceAfter',
    width: 110,
    render: (row) => formatUsd(row.balanceAfter)
  },
  {
    title: '备注',
    key: 'note',
    minWidth: 180,
    render: (row) => walletNote(row.note)
  }
]

onMounted(() => { void loadWallet(); void loadUsage() })
</script>

<template>
  <UiTabs v-model:value="activeTab" type="line" animated>
    <UiTabPane name="usage" tab="用量">
      <div class="filter-bar">
        <div class="filter-presets">
          <button
            v-for="preset in datePresets"
            :key="preset.label"
            type="button"
            class="preset-btn"
            :class="{
              active: preset.value ? dateFrom === preset.value[0] && dateEnd === preset.value[1] : !dateFrom && !dateEnd
            }"
            @click="applyPreset(preset)"
          >
            {{ preset.label }}
          </button>
        </div>
        <div class="filter-dates">
          <button type="button" class="preset-btn" :class="{ active: failureOnly }" @click="failureOnly = !failureOnly">仅看失败</button>
          <input type="date" v-model="dateFrom" class="date-input" title="开始日期" />
          <span class="date-sep">—</span>
          <input type="date" v-model="dateEnd" class="date-input" title="结束日期" />
        </div>
      </div>
      <UiCard class="table-card hidden md:block" :bordered="false">
        <UiDataTable :columns="usageColumns" :data="usageRows" :loading="usageLoading" :bordered="false" :scroll-x="940" />
      </UiCard>
      <div class="grid gap-3 md:hidden">
        <p v-if="usageLoading" class="py-8 text-center text-sm text-gray-500" role="status">正在加载用量…</p>
        <p v-else-if="!usageRows.length" class="card p-6 text-center text-sm text-gray-500">当前筛选范围内没有调用记录</p>
        <article v-for="row in usageRows" :key="row.id" class="card min-w-0 p-4">
          <div class="flex items-start justify-between gap-3"><h2 class="min-w-0 break-all text-sm font-semibold">{{ row.model || '未知模型' }}</h2><UiTag :type="row.status === 'success' ? 'success' : 'error'">{{ row.status === 'success' ? '成功' : '失败' }}</UiTag></div>
          <p class="mt-1 text-xs text-gray-500">{{ formatTime(row.ts) }} · {{ row.apiKeyName || '无 Key' }}</p>
          <div class="mt-4 flex flex-wrap justify-between gap-2 text-sm"><span>{{ usageLabel(row) }}</span><strong>{{ row.subscriptionPoints != null ? formatSubscriptionUsage(row.subscriptionPoints) : formatUsd(row.cost) }}</strong></div>
          <p v-if="row.status !== 'success' && row.errorCategory" class="mt-2 text-sm text-red-600">{{ row.errorCategory }}</p>
          <details class="mt-3 border-t border-gray-100 pt-3 text-xs dark:border-dark-700"><summary class="cursor-pointer text-primary-700 dark:text-primary-300">用量与耗时详情</summary><dl class="mt-3 grid grid-cols-2 gap-3"><div><dt class="text-gray-500">用量来源</dt><dd>{{ usageSourceLabel(row.usageSource) }}</dd></div><div><dt class="text-gray-500">服务商</dt><dd>{{ row.provider === 'modelbridge' ? 'Model Bridge' : row.provider }}</dd></div><div><dt class="text-gray-500">首字</dt><dd>{{ duration(row.firstTokenMs) }}</dd></div><div><dt class="text-gray-500">耗时</dt><dd>{{ duration(row.latencyMs) }}</dd></div></dl><p v-if="row.modelMismatch" class="mt-2 text-amber-700">调用模型与返回模型不一致</p></details>
        </article>
      </div>
      <UiPagination class="mt-4" v-model:page="usagePage" :page-size="pageSize" :item-count="usageTotal" :disabled="usageLoading" />
    </UiTabPane>
    <UiTabPane name="wallet" tab="钱包">
      <UiCard class="table-card hidden md:block" :bordered="false">
        <UiDataTable :columns="walletColumns" :data="walletRows" :loading="walletLoading" :bordered="false" :scroll-x="660" />
      </UiCard>
      <div class="grid gap-3 md:hidden">
        <p v-if="walletLoading" class="py-8 text-center text-sm text-gray-500" role="status">正在加载钱包…</p>
        <p v-else-if="!walletRows.length" class="card p-6 text-center text-sm text-gray-500">暂无钱包流水</p>
        <article v-for="row in walletRows" :key="row.id" class="card min-w-0 p-4 text-sm"><div class="flex justify-between gap-3"><strong>{{ walletType(row.type) }}</strong><strong :class="row.amount < 0 ? 'text-red-600' : 'text-emerald-600'">{{ formatUsd(row.amount) }}</strong></div><p class="mt-2 text-xs text-gray-500">{{ formatTime(row.createdAt) }} · 余额 {{ formatUsd(row.balanceAfter) }}</p><p class="mt-2 break-words">{{ walletNote(row.note) }}</p></article>
      </div>
      <UiPagination class="mt-4" v-model:page="walletPage" :page-size="pageSize" :item-count="walletTotal" :disabled="walletLoading" />
    </UiTabPane>
  </UiTabs>
</template>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.filter-presets {
  display: flex;
  gap: 4px;
}

.preset-btn {
  padding: 4px 12px;
  border: 1px solid var(--n-border-color, #e5e7eb);
  border-radius: 6px;
  background: var(--n-color, #fff);
  color: var(--n-text-color-2, #6b7280);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.preset-btn:hover {
  @apply border-primary-500 text-primary-600;
}

.preset-btn.active {
  @apply border-primary-500 bg-primary-500 text-white;
}

.filter-dates {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.date-input {
  min-width: 0;
  flex: 1;
  padding: 4px 10px;
  border: 1px solid var(--n-border-color, #e5e7eb);
  border-radius: 6px;
  font-size: 13px;
  color: var(--n-text-color, #374151);
  background: var(--n-color, #fff);
  outline: none;
  transition: border-color 0.2s;
}

.date-input:focus {
  @apply border-primary-500;
}

.date-sep {
  color: var(--n-text-color-3, #9ca3af);
  font-size: 13px;
}

:deep(.token-total) {
  cursor: help;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

.token-breakdown {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 150px;
}

.token-breakdown-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.token-breakdown-label {
  opacity: 0.75;
}

.token-breakdown-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

:deep(.amount) {
  color: #16a34a;
  font-weight: 700;
}

:deep(.danger) {
  color: #dc2626;
  font-weight: 700;
}

:deep(.status-cell) {
  display: grid;
  gap: 4px;
  align-items: start;
  color: #dc2626;
  font-size: 12px;
}
</style>
