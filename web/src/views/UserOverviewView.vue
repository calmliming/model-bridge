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

interface PaymentOrder {
  id: string
  provider: string
  status: string
  amount: number
  paymentUrl: string | null
  expiresAt: number
  paidAt: number | null
  createdAt: number
}

const message = useMessage()
const loading = ref(true)
const creatingOrder = ref(false)
const showRecharge = ref(false)
const showPaymentQr = ref(false)
const rechargeAmount = ref(10)
const selectedProvider = ref<'manual' | 'alipay' | 'wechat'>('manual')
const availableProviders = ref<Array<'manual' | 'alipay' | 'wechat'>>(['manual'])
const currentPaymentOrder = ref<PaymentOrder | null>(null)
const user = ref<UserMe | null>(null)
const transactions = ref<WalletTransaction[]>([])
const usageLogs = ref<UsageLog[]>([])
const paymentOrders = ref<PaymentOrder[]>([])

const totalRecentCost = computed(() => usageLogs.value.reduce((sum, row) => sum + row.cost, 0))

const providerLabels: Record<string, string> = {
  manual: '线下转账',
  alipay: '支付宝',
  wechat: '微信支付',
}

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

async function load() {
  loading.value = true
  try {
    const [walletRes, usageRes, ordersRes, providersRes] = await Promise.all([
      api.get('/users/wallet'),
      api.get('/users/usage', { params: { pageSize: 8 } }),
      api.get('/users/payment-orders', { params: { pageSize: 8 } }),
      api.get('/users/payment-providers'),
    ])
    user.value = walletRes.data.user
    transactions.value = walletRes.data.transactions
    usageLogs.value = usageRes.data.logs
    paymentOrders.value = ordersRes.data.orders
    availableProviders.value = providersRes.data.providers
    if (availableProviders.value.length > 0) {
      selectedProvider.value = availableProviders.value[0]!
    }
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

async function createRechargeOrder() {
  if (!Number.isFinite(rechargeAmount.value) || rechargeAmount.value <= 0) {
    message.warning('请输入有效金额')
    return
  }
  creatingOrder.value = true
  try {
    const { data } = await api.post('/users/payment-orders', {
      amount: rechargeAmount.value,
      provider: selectedProvider.value,
    })
    currentPaymentOrder.value = data.order
    showRecharge.value = false

    if (selectedProvider.value === 'alipay' || selectedProvider.value === 'wechat') {
      showPaymentQr.value = true
      message.success('订单创建成功，请扫码支付')
    } else {
      message.success('充值订单已创建，请联系管理员完成入账')
    }

    await load()
  } catch (e) {
    message.error(errMsg(e, '创建订单失败'))
  } finally {
    creatingOrder.value = false
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

const paymentColumns: DataTableColumns<PaymentOrder> = [
  { title: '时间', key: 'createdAt', minWidth: 140, render: (row) => formatTime(row.createdAt) },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('span', { class: 'amount' }, formatUsd(row.amount)) },
  { title: '状态', key: 'status', width: 90, render: (row) => h(NTag, { size: 'small', bordered: false, type: row.status === 'paid' ? 'success' : row.status === 'pending' ? 'warning' : 'default' }, { default: () => row.status }) },
  { title: '入账时间', key: 'paidAt', minWidth: 140, render: (row) => row.paidAt ? formatTime(row.paidAt) : '—' },
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
          <n-button size="small" secondary type="primary" @click="showRecharge = true">充值</n-button>
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
        <n-gi>
          <n-card title="充值订单" :bordered="false">
            <n-data-table :columns="paymentColumns" :data="paymentOrders" :bordered="false" size="small" />
          </n-card>
        </n-gi>
      </n-grid>
    </n-spin>

    <n-modal v-model:show="showRecharge" preset="card" title="发起充值" style="width: 420px">
      <n-form label-placement="top">
        <n-form-item label="充值金额（USD）">
          <n-input-number v-model:value="rechargeAmount" :min="0.01" :precision="2" style="width: 100%" />
        </n-form-item>
        <n-form-item label="支付方式">
          <n-radio-group v-model:value="selectedProvider">
            <n-space vertical>
              <n-radio v-for="p in availableProviders" :key="p" :value="p">
                {{ providerLabels[p] }}
              </n-radio>
            </n-space>
          </n-radio-group>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showRecharge = false">取消</n-button>
          <n-button type="primary" :loading="creatingOrder" @click="createRechargeOrder">创建订单</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 支付二维码弹窗 -->
    <n-modal v-model:show="showPaymentQr" preset="card" title="扫码支付" style="max-width: 480px">
      <div v-if="currentPaymentOrder" style="text-align: center">
        <n-alert type="info" style="margin-bottom: 16px">
          请使用{{ providerLabels[currentPaymentOrder.provider] }}扫描下方二维码完成支付
        </n-alert>
        <div style="display: flex; justify-content: center; margin: 24px 0">
          <img
            v-if="currentPaymentOrder.paymentUrl"
            :src="`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(currentPaymentOrder.paymentUrl)}`"
            alt="支付二维码"
            style="width: 240px; height: 240px; border: 1px solid #e5e7eb; border-radius: 8px"
          >
        </div>
        <n-text depth="3" style="font-size: 14px">
          订单金额: {{ formatUsd(currentPaymentOrder.amount) }}
        </n-text>
        <n-divider />
        <n-space justify="center">
          <n-button @click="showPaymentQr = false">关闭</n-button>
          <n-button type="primary" @click="load">刷新状态</n-button>
        </n-space>
      </div>
    </n-modal>
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

.metric-card :deep(.n-button) {
  margin-top: 12px;
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
