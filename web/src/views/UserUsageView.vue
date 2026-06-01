<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import { NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface UsageLog {
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

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

function totalTokens(row: UsageLog): string {
  return (row.inputTokens + row.outputTokens + row.cacheCreateTokens + row.cacheReadTokens).toLocaleString('en-US')
}

async function load() {
  usageLoading.value = true
  walletLoading.value = true
  try {
    const [usageRes, walletRes] = await Promise.all([
      api.get('/users/usage', { params: { pageSize: 100 } }),
      api.get('/users/wallet/transactions', { params: { pageSize: 100 } }),
    ])
    usageRows.value = usageRes.data.logs
    walletRows.value = walletRes.data.transactions
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    usageLoading.value = false
    walletLoading.value = false
  }
}

const usageColumns: DataTableColumns<UsageLog> = [
  { title: '时间', key: 'ts', minWidth: 150, render: (row) => formatTime(row.ts) },
  { title: 'Key', key: 'apiKeyName', minWidth: 130, render: (row) => row.apiKeyName || '—' },
  { title: '服务商', key: 'provider', width: 90 },
  { title: '模型', key: 'model', minWidth: 180, render: (row) => row.model || '—' },
  { title: 'Tokens', key: 'tokens', width: 110, render: totalTokens },
  { title: '成本', key: 'cost', width: 100, render: (row) => formatUsd(row.cost) },
  { title: '延迟', key: 'latencyMs', width: 90, render: (row) => row.latencyMs == null ? '—' : `${row.latencyMs}ms` },
  { title: '状态', key: 'status', width: 90, render: (row) => h(NTag, { size: 'small', bordered: false, type: row.status === 'success' ? 'success' : 'error' }, { default: () => row.status }) },
]

const walletColumns: DataTableColumns<WalletTransaction> = [
  { title: '时间', key: 'createdAt', minWidth: 150, render: (row) => formatTime(row.createdAt) },
  { title: '类型', key: 'type', width: 90 },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('span', { class: row.amount < 0 ? 'danger' : 'amount' }, formatUsd(row.amount)) },
  { title: '余额', key: 'balanceAfter', width: 110, render: (row) => formatUsd(row.balanceAfter) },
  { title: '备注', key: 'note', minWidth: 180, render: (row) => row.note || '—' },
]

onMounted(load)
</script>

<template>
  <n-tabs type="line" animated>
    <n-tab-pane name="usage" tab="用量">
      <n-card class="table-card" :bordered="false">
        <n-data-table :columns="usageColumns" :data="usageRows" :loading="usageLoading" :bordered="false" :scroll-x="940" />
      </n-card>
    </n-tab-pane>
    <n-tab-pane name="wallet" tab="钱包">
      <n-card class="table-card" :bordered="false">
        <n-data-table :columns="walletColumns" :data="walletRows" :loading="walletLoading" :bordered="false" />
      </n-card>
    </n-tab-pane>
  </n-tabs>
</template>

<style scoped>
:deep(.amount) {
  color: #16a34a;
  font-weight: 700;
}

:deep(.danger) {
  color: #dc2626;
  font-weight: 700;
}
</style>
