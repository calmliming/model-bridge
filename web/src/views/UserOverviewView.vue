<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface UserMe {
  email: string
  name: string
  balance: number
}

interface WalletTransaction {
  id: string
  type: string
  amount: number
  balanceAfter: number
  note: string | null
  createdAt: number
}

interface UsageLog {
  id: string
  ts: number
  provider: string
  model: string | null
  status: string
  cost: number
}

const message = useMessage()
const loading = ref(true)
const user = ref<UserMe | null>(null)
const transactions = ref<WalletTransaction[]>([])
const usageLogs = ref<UsageLog[]>([])

const totalRecentCost = computed(() => usageLogs.value.reduce((sum, row) => sum + row.cost, 0))

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

async function load() {
  loading.value = true
  try {
    const [walletRes, usageRes] = await Promise.all([
      api.get('/users/wallet'),
      api.get('/users/usage', { params: { pageSize: 8 } }),
    ])
    user.value = walletRes.data.user
    transactions.value = walletRes.data.transactions
    usageLogs.value = usageRes.data.logs
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

const walletColumns: DataTableColumns<WalletTransaction> = [
  { title: '时间', key: 'createdAt', minWidth: 140, render: (row) => formatTime(row.createdAt) },
  { title: '类型', key: 'type', width: 90 },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('span', { class: row.amount < 0 ? 'danger' : 'amount' }, formatUsd(row.amount)) },
  { title: '余额', key: 'balanceAfter', width: 110, render: (row) => formatUsd(row.balanceAfter) },
  { title: '备注', key: 'note', minWidth: 160, render: (row) => row.note || '—' },
]

const usageColumns: DataTableColumns<UsageLog> = [
  { title: '时间', key: 'ts', minWidth: 140, render: (row) => formatTime(row.ts) },
  { title: '服务商', key: 'provider', width: 90 },
  { title: '模型', key: 'model', minWidth: 160, render: (row) => row.model || '—' },
  { title: '成本', key: 'cost', width: 100, render: (row) => formatUsd(row.cost) },
  { title: '状态', key: 'status', width: 90, render: (row) => h(NTag, { size: 'small', bordered: false, type: row.status === 'success' ? 'success' : 'error' }, { default: () => row.status }) },
]

onMounted(load)
</script>

<template>
  <div>
    <n-spin :show="loading">
      <div class="metric-grid">
        <n-card class="metric-card" :bordered="false">
          <span>钱包余额</span>
          <strong :class="{ danger: (user?.balance ?? 0) <= 0 }">{{ formatUsd(user?.balance ?? 0) }}</strong>
        </n-card>
        <n-card class="metric-card" :bordered="false">
          <span>近期请求</span>
          <strong>{{ usageLogs.length }}</strong>
        </n-card>
        <n-card class="metric-card" :bordered="false">
          <span>近期成本</span>
          <strong>{{ formatUsd(totalRecentCost) }}</strong>
        </n-card>
      </div>

      <n-grid :cols="2" :x-gap="18" :y-gap="18" responsive="screen">
        <n-gi>
          <n-card title="钱包流水" :bordered="false">
            <n-data-table :columns="walletColumns" :data="transactions" :bordered="false" size="small" />
          </n-card>
        </n-gi>
        <n-gi>
          <n-card title="近期用量" :bordered="false">
            <n-data-table :columns="usageColumns" :data="usageLogs" :bordered="false" size="small" />
          </n-card>
        </n-gi>
      </n-grid>
    </n-spin>
  </div>
</template>

<style scoped>
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}

.metric-card {
  border-radius: 8px;
}

.metric-card span,
.metric-card strong {
  display: block;
}

.metric-card span {
  color: rgba(15, 23, 42, 0.52);
  font-size: 12px;
}

.metric-card strong {
  margin-top: 8px;
  color: #0f172a;
  font-size: 28px;
}

:deep(.amount) {
  color: #16a34a;
  font-weight: 700;
}

.danger,
:deep(.danger) {
  color: #dc2626;
  font-weight: 700;
}

@media (max-width: 780px) {
  .metric-grid {
    grid-template-columns: 1fr;
  }
}
</style>
