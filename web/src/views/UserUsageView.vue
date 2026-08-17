<script setup lang="ts">
import { h, onMounted, ref, watch } from 'vue'
import { UiTag, UiTooltip } from '../components/ui'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface UsageLog {
  id: string
  ts: number
  provider: string
  model: string | null
  status: string
  errorCategory: string | null
  modelMismatch: boolean
  latencyMs: number | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
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
const usageLoading = ref(true)
const walletLoading = ref(true)
const usageRows = ref<UsageLog[]>([])
const walletRows = ref<WalletTransaction[]>([])

// Date filter — stored as "YYYY-MM-DD" strings for the native date inputs,
// converted to epoch-ms range when calling the API.
const dateFrom = ref<string>('')
const dateEnd = ref<string>('')
const failureOnly = ref(false)

const datePresets = [
  { label: '全部', value: null as null | [string, string] },
  { label: '今天', value: [todayStr(), todayStr()] as [string, string] },
  { label: '近7天', value: [daysAgoStr(6), todayStr()] as [string, string] },
  { label: '近30天', value: [daysAgoStr(29), todayStr()] as [string, string] },
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

function toEndOfDayMs(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59.999`).getTime()
}

function toStartOfDayMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000`).getTime()
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
  loadUsage()
})

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

function totalTokens(row: UsageLog) {
  const total = row.inputTokens + row.outputTokens + row.cacheCreateTokens + row.cacheReadTokens
  const rows: [string, number][] = [
    ['输入', row.inputTokens],
    ['输出', row.outputTokens],
    ...(row.reasoningTokens > 0 ? [['推理', row.reasoningTokens] as [string, number]] : []),
    ['缓存写入', row.cacheCreateTokens],
    ['缓存读取', row.cacheReadTokens],
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
          rows.map(([label, value]) =>
            h('div', { class: 'token-breakdown-row' }, [
              h('span', { class: 'token-breakdown-label' }, label),
              h('span', { class: 'token-breakdown-value' }, value.toLocaleString('en-US')),
            ]),
          ),
        ),
    },
  )
}

async function loadUsage() {
  usageLoading.value = true
  try {
    const params: Record<string, unknown> = { pageSize: 100 }
    if (dateFrom.value) params.startDate = toStartOfDayMs(dateFrom.value)
    if (dateEnd.value) params.endDate = toEndOfDayMs(dateEnd.value)
    if (failureOnly.value) params.status = 'error'
    const usageRes = await api.get('/users/usage', { params })
    usageRows.value = usageRes.data.logs
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    usageLoading.value = false
  }
}

async function load() {
  usageLoading.value = true
  walletLoading.value = true
  try {
    const [walletRes] = await Promise.all([
      api.get('/users/wallet/transactions', { params: { pageSize: 100 } }),
    ])
    walletRows.value = walletRes.data.transactions
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    walletLoading.value = false
  }
  await loadUsage()
}

const usageColumns: TableColumn<UsageLog>[] = [
  { title: '时间', key: 'ts', minWidth: 150, render: (row) => formatTime(row.ts) },
  { title: 'Key', key: 'apiKeyName', minWidth: 130, render: (row) => row.apiKeyName || '—' },
  { title: '服务商', key: 'provider', width: 90 },
  { title: '模型', key: 'model', minWidth: 180, render: (row) => row.model || '—' },
  { title: 'Tokens', key: 'tokens', width: 110, render: totalTokens },
  { title: '成本', key: 'cost', width: 100, render: (row) => formatUsd(row.cost) },
  { title: '延迟', key: 'latencyMs', width: 90, render: (row) => row.latencyMs == null ? '—' : `${row.latencyMs}ms` },
  {
    title: '状态',
    key: 'status',
    minWidth: 130,
    render: (row) => h('div', { class: 'status-cell' }, [
      h(UiTag, { size: 'small', bordered: false, type: row.status === 'success' ? 'success' : 'error' }, { default: () => row.status }),
      row.errorCategory ? h('span', null, row.errorCategory) : null,
      row.modelMismatch ? h(UiTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '模型异常' }) : null,
    ]),
  },
]

const walletColumns: TableColumn<WalletTransaction>[] = [
  { title: '时间', key: 'createdAt', minWidth: 150, render: (row) => formatTime(row.createdAt) },
  { title: '类型', key: 'type', width: 90 },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('span', { class: row.amount < 0 ? 'danger' : 'amount' }, formatUsd(row.amount)) },
  { title: '余额', key: 'balanceAfter', width: 110, render: (row) => formatUsd(row.balanceAfter) },
  { title: '备注', key: 'note', minWidth: 180, render: (row) => row.note || '—' },
]

onMounted(load)
</script>

<template>
  <UiTabs type="line" animated>
    <UiTabPane name="usage" tab="用量">
      <div class="filter-bar">
        <div class="filter-presets">
          <button
            v-for="preset in datePresets"
            :key="preset.label"
            type="button"
            class="preset-btn"
            :class="{ active: preset.value ? (dateFrom === preset.value[0] && dateEnd === preset.value[1]) : (!dateFrom && !dateEnd) }"
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
      <UiCard class="table-card" :bordered="false">
        <UiDataTable :columns="usageColumns" :data="usageRows" :loading="usageLoading" :bordered="false" :scroll-x="940" />
      </UiCard>
    </UiTabPane>
    <UiTabPane name="wallet" tab="钱包">
      <UiCard class="table-card" :bordered="false">
        <UiDataTable :columns="walletColumns" :data="walletRows" :loading="walletLoading" :bordered="false" :scroll-x="660" />
      </UiCard>
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
  border-color: var(--n-primary-color, #6366f1);
  color: var(--n-primary-color, #6366f1);
}

.preset-btn.active {
  background: var(--n-primary-color, #6366f1);
  border-color: var(--n-primary-color, #6366f1);
  color: #fff;
}

.filter-dates {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-input {
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
  border-color: var(--n-primary-color, #6366f1);
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
