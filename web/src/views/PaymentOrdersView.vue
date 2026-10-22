<script setup lang="ts">
import { h, onMounted, ref, watch } from 'vue'
import { UiButton, UiSpace, UiTag } from '../components/ui'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { calendarDayRangeMs, formatTime, formatUsd } from '../utils'

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
const page = ref(1), total = ref(0), pageSize = 20
const search = ref(''), status = ref(''), dateFrom = ref(''), dateEnd = ref('')
const appliedFilters = ref<Record<string, unknown>>({})
let loadVersion = 0
const statusLabel: Record<PaymentOrder['status'], string> = { pending: '待支付', paid: '已入账', canceled: '已取消', expired: '已过期' }
const providerLabel = (value: string) => ({ manual: '线下转账', alipay: '支付宝', alipay_web: '支付宝网页', wechat: '微信支付', waffo: 'Waffo' } as Record<string, string>)[value] || value

function applyFilters() {
  if (dateFrom.value && dateEnd.value && dateFrom.value > dateEnd.value) { message.warning('开始日期不能晚于结束日期'); return }
  appliedFilters.value = { search: search.value.trim() || undefined, status: status.value || undefined,
    startDate: dateFrom.value ? calendarDayRangeMs(dateFrom.value)[0] : undefined,
    endDate: dateEnd.value ? calendarDayRangeMs(dateEnd.value)[1] : undefined }
  if (page.value === 1) void load()
  else page.value = 1
}
function resetFilters() { search.value = ''; status.value = ''; dateFrom.value = ''; dateEnd.value = ''; applyFilters() }
watch(page, load)

const statusType: Record<PaymentOrder['status'], 'success' | 'warning' | 'error' | 'default'> = {
  pending: 'warning',
  paid: 'success',
  canceled: 'default',
  expired: 'error',
}

async function load() {
  const version = ++loadVersion
  loading.value = true
  try {
    const { data } = await api.get('/admin/payment-orders', { params: { ...appliedFilters.value, page: page.value, pageSize } })
    if (version !== loadVersion) return
    orders.value = data.orders
    total.value = data.total
    const lastPage = Math.max(1, Math.ceil(data.total / pageSize))
    if (page.value > lastPage) page.value = lastPage
  } catch (e) {
    if (version === loadVersion) message.error(errMsg(e))
  } finally {
    if (version === loadVersion) loading.value = false
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
        const { data } = await api.post(`/admin/payment-orders/${row.id}/cancel`, {})
        if (data.order.status === 'paid') message.info('订单已付款并入账')
        else message.success('已取消')
        await load()
      } catch (e) {
        message.error(errMsg(e, '取消失败'))
      }
    },
  })
}

const columns: TableColumn<PaymentOrder>[] = [
  { title: '时间', key: 'createdAt', minWidth: 145, render: (row) => formatTime(row.createdAt) },
  { title: '用户', key: 'user', minWidth: 210, render: (row) => h('div', [h('strong', row.userName || '—'), h('span', { class: 'subtext' }, row.userEmail || row.id)]) },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('strong', { class: 'amount' }, formatUsd(row.amount)) },
  { title: '状态', key: 'status', width: 110, render: (row) => h(UiTag, { size: 'small', type: statusType[row.status], bordered: false }, { default: () => statusLabel[row.status] }) },
  { title: '通道', key: 'provider', width: 100, render: row => providerLabel(row.provider) },
  { title: '过期时间', key: 'expiresAt', minWidth: 145, render: (row) => formatTime(row.expiresAt) },
  { title: '入账时间', key: 'paidAt', minWidth: 145, render: (row) => row.paidAt ? formatTime(row.paidAt) : '—' },
  { title: '备注', key: 'note', minWidth: 160, render: (row) => row.note || '—' },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    render: (row) => row.status === 'pending'
      ? h(UiSpace, { size: 4, wrap: false }, {
        default: () => [
          h(UiButton, { size: 'small', type: 'primary', quaternary: true, onClick: () => confirmOrder(row) }, { default: () => '入账' }),
          h(UiButton, { size: 'small', type: 'error', quaternary: true, onClick: () => cancelOrder(row) }, { default: () => '取消' }),
        ],
      })
      : '—',
  },
]

onMounted(load)
</script>

<template>
  <div>
    <form class="order-filters" @submit.prevent="applyFilters">
      <label class="min-w-0"><span class="field-label">订单 / 用户</span><UiInput v-model:value="search" placeholder="订单号、名称或邮箱" /></label>
      <label class="min-w-0"><span class="field-label">状态</span><select v-model="status" class="input"><option value="">全部状态</option><option v-for="(label, value) in statusLabel" :key="value" :value="value">{{ label }}</option></select></label>
      <label class="min-w-0"><span class="field-label">开始日期</span><input v-model="dateFrom" type="date" class="input min-w-0" /></label>
      <label class="min-w-0"><span class="field-label">结束日期</span><input v-model="dateEnd" type="date" class="input min-w-0" /></label>
      <div class="flex flex-wrap gap-2"><UiButton type="primary" native-type="submit">查询</UiButton><UiButton @click="resetFilters">重置</UiButton></div>
    </form>
    <div class="toolbar items-center justify-between">
      <span class="text-sm text-gray-500">共 {{ total }} 条充值订单</span>
      <UiButton secondary :loading="loading" @click="load">刷新</UiButton>
    </div>
    <UiCard class="table-card hidden md:block" :bordered="false">
      <UiDataTable :columns="columns" :data="orders" :loading="loading" :bordered="false" :scroll-x="1220" empty-text="暂无符合条件的充值订单" />
    </UiCard>
    <div class="grid gap-3 md:hidden">
      <p v-if="loading" class="py-8 text-center text-sm text-gray-500" role="status">正在加载订单…</p>
      <p v-else-if="!orders.length" class="card p-6 text-center text-sm text-gray-500">暂无符合条件的充值订单</p>
      <article v-for="row in orders" :key="row.id" class="card min-w-0 p-4">
        <div class="flex items-start justify-between gap-3"><strong class="min-w-0 break-all">{{ row.userName || row.userEmail || '未知用户' }}</strong><UiTag :type="statusType[row.status]">{{ statusLabel[row.status] }}</UiTag></div>
        <p class="mt-1 break-all text-xs text-gray-500">{{ row.userEmail }}</p>
        <div class="mt-4 flex justify-between gap-2"><strong class="text-xl">{{ formatUsd(row.amount) }}</strong><span class="text-sm text-gray-500">{{ providerLabel(row.provider) }}</span></div>
        <details class="mt-3 border-t border-gray-100 pt-3 text-xs dark:border-dark-700"><summary class="cursor-pointer text-primary-700">订单详情</summary><p class="mt-2 break-all">订单号：{{ row.id }}</p><p class="mt-2">创建：{{ formatTime(row.createdAt) }}</p><p class="mt-2">到期：{{ formatTime(row.expiresAt) }}</p><p v-if="row.paidAt" class="mt-2">入账：{{ formatTime(row.paidAt) }}</p><p v-if="row.note" class="mt-2 break-words">{{ row.note }}</p></details>
        <div v-if="row.status === 'pending'" class="mt-4 flex gap-2"><UiButton size="small" type="primary" @click="confirmOrder(row)">确认入账</UiButton><UiButton size="small" @click="cancelOrder(row)">取消订单</UiButton></div>
      </article>
    </div>
    <UiPagination class="mt-4" v-model:page="page" :page-size="pageSize" :item-count="total" :disabled="loading" />
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  margin-bottom: 14px;
}
.order-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: end; margin-bottom: 18px; }
@media (min-width: 1280px) { .order-filters { grid-template-columns: minmax(0, 1.5fr) repeat(3, minmax(0, 1fr)); } }

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
