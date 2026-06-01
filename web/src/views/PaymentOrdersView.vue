<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import { NButton, NSpace, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface PaymentOrder {
  id: string
  userEmail: string | null
  userName: string | null
  provider: string
  status: 'pending' | 'paid' | 'canceled' | 'expired'
  amount: number
  providerOrderId: string | null
  walletTransactionId: string | null
  note: string | null
  expiresAt: number
  paidAt: number | null
  createdAt: number
}

const message = useMessage()
const dialog = useDialog()
const loading = ref(false)
const orders = ref<PaymentOrder[]>([])

const statusType: Record<PaymentOrder['status'], 'success' | 'warning' | 'error' | 'default'> = {
  pending: 'warning',
  paid: 'success',
  canceled: 'default',
  expired: 'error',
}

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/payment-orders', { params: { pageSize: 100 } })
    orders.value = data.orders
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

function confirmOrder(row: PaymentOrder) {
  dialog.warning({
    title: '确认入账',
    content: `确认订单 ${row.id} 已收款，并为用户入账 ${formatUsd(row.amount)}？`,
    positiveText: '确认入账',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.post(`/admin/payment-orders/${row.id}/confirm`, {})
        message.success('已入账')
        await load()
      } catch (e) {
        message.error(errMsg(e, '确认失败'))
      }
    },
  })
}

function cancelOrder(row: PaymentOrder) {
  dialog.warning({
    title: '取消订单',
    content: `确认取消订单 ${row.id}？`,
    positiveText: '取消订单',
    negativeText: '返回',
    onPositiveClick: async () => {
      try {
        await api.post(`/admin/payment-orders/${row.id}/cancel`, {})
        message.success('已取消')
        await load()
      } catch (e) {
        message.error(errMsg(e, '取消失败'))
      }
    },
  })
}

const columns: DataTableColumns<PaymentOrder> = [
  { title: '时间', key: 'createdAt', minWidth: 145, render: (row) => formatTime(row.createdAt) },
  { title: '用户', key: 'user', minWidth: 210, render: (row) => h('div', [h('strong', row.userName || '—'), h('span', { class: 'subtext' }, row.userEmail || row.id)]) },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('strong', { class: 'amount' }, formatUsd(row.amount)) },
  { title: '状态', key: 'status', width: 110, render: (row) => h(NTag, { size: 'small', type: statusType[row.status], bordered: false }, { default: () => row.status }) },
  { title: '通道', key: 'provider', width: 100 },
  { title: '过期时间', key: 'expiresAt', minWidth: 145, render: (row) => formatTime(row.expiresAt) },
  { title: '入账时间', key: 'paidAt', minWidth: 145, render: (row) => row.paidAt ? formatTime(row.paidAt) : '—' },
  { title: '备注', key: 'note', minWidth: 160, render: (row) => row.note || '—' },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render: (row) => row.status === 'pending'
      ? h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(NButton, { size: 'small', type: 'primary', quaternary: true, onClick: () => confirmOrder(row) }, { default: () => '入账' }),
          h(NButton, { size: 'small', type: 'error', quaternary: true, onClick: () => cancelOrder(row) }, { default: () => '取消' }),
        ],
      })
      : '—',
  },
]

onMounted(load)
</script>

<template>
  <div>
    <div class="toolbar">
      <n-button secondary :loading="loading" @click="load">刷新</n-button>
    </div>
    <n-card class="table-card" :bordered="false">
      <n-data-table :columns="columns" :data="orders" :loading="loading" :bordered="false" :scroll-x="1220" />
    </n-card>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 14px;
}

.amount {
  color: #16a34a;
}

:deep(.subtext) {
  display: block;
  margin-top: 3px;
  color: rgba(15, 23, 42, 0.48);
  font-size: 12px;
}
</style>
