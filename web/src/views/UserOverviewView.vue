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

interface Subscription {
  id: string
  planName: string | null
  groupName: string | null
  status: string
  expiresAt: number
  dailyRemaining: number | null
  weeklyRemaining: number | null
  monthlyRemaining: number | null
}

interface StorePlan {
  id: string
  name: string
  description: string | null
  price: number
  validityDays: number
  dailyLimitUsd: number | null
  weeklyLimitUsd: number | null
  monthlyLimitUsd: number | null
}

const message = useMessage()
const loading = ref(true)
const creatingOrder = ref(false)
const showRecharge = ref(false)
const showPaymentQr = ref(false)
const showRedeem = ref(false)
const redeeming = ref(false)
const redeemInput = ref('')
const showStore = ref(false)
const purchasingId = ref<string | null>(null)
const subscriptions = ref<Subscription[]>([])
const storePlans = ref<StorePlan[]>([])
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
    const [walletRes, usageRes, ordersRes, providersRes, subsRes] = await Promise.all([
      api.get('/users/wallet'),
      api.get('/users/usage', { params: { pageSize: 8 } }),
      api.get('/users/payment-orders', { params: { pageSize: 8 } }),
      api.get('/users/payment-providers'),
      api.get('/users/subscriptions'),
    ])
    user.value = walletRes.data.user
    transactions.value = walletRes.data.transactions
    usageLogs.value = usageRes.data.logs
    paymentOrders.value = ordersRes.data.orders
    availableProviders.value = providersRes.data.providers
    subscriptions.value = subsRes.data.subscriptions
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

async function redeem() {
  const code = redeemInput.value.trim()
  if (!code) {
    message.warning('请输入兑换码')
    return
  }
  redeeming.value = true
  try {
    const { data } = await api.post('/users/redeem', { code })
    showRedeem.value = false
    redeemInput.value = ''
    message.success(`兑换成功，到账 ${formatUsd(data.value)}`)
    await load()
  } catch (e) {
    message.error(errMsg(e, '兑换失败'))
  } finally {
    redeeming.value = false
  }
}

async function openStore() {
  showStore.value = true
  try {
    const { data } = await api.get('/users/subscription-plans')
    storePlans.value = data.plans
  } catch (e) {
    message.error(errMsg(e, '加载套餐失败'))
  }
}

async function purchase(plan: StorePlan) {
  purchasingId.value = plan.id
  try {
    await api.post('/users/subscriptions/purchase', { planId: plan.id })
    message.success(`已开通「${plan.name}」`)
    showStore.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '购买失败'))
  } finally {
    purchasingId.value = null
  }
}

function limitLabel(plan: StorePlan): string {
  const parts: string[] = []
  if (plan.dailyLimitUsd != null) parts.push(`日 $${plan.dailyLimitUsd}`)
  if (plan.weeklyLimitUsd != null) parts.push(`周 $${plan.weeklyLimitUsd}`)
  if (plan.monthlyLimitUsd != null) parts.push(`月 $${plan.monthlyLimitUsd}`)
  return parts.length ? parts.join(' · ') : '额度不限'
}

function remainLabel(sub: Subscription): string {
  const parts: string[] = []
  if (sub.dailyRemaining != null) parts.push(`日剩 $${sub.dailyRemaining.toFixed(2)}`)
  if (sub.weeklyRemaining != null) parts.push(`周剩 $${sub.weeklyRemaining.toFixed(2)}`)
  if (sub.monthlyRemaining != null) parts.push(`月剩 $${sub.monthlyRemaining.toFixed(2)}`)
  return parts.length ? parts.join(' · ') : '额度不限'
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
          <n-space :size="8">
            <n-button size="small" secondary type="primary" @click="showRecharge = true">充值</n-button>
            <n-button size="small" secondary @click="showRedeem = true">兑换码</n-button>
          </n-space>
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

      <n-card title="我的订阅" :bordered="false" style="margin-bottom: 18px">
        <template #header-extra>
          <n-button size="small" secondary type="primary" @click="openStore">套餐商店</n-button>
        </template>
        <p v-if="!subscriptions.length" class="sub-empty">
          暂无订阅。可在「套餐商店」用余额开通，或联系管理员分配。
        </p>
        <div v-for="sub in subscriptions" :key="sub.id" class="sub-row">
          <div class="sub-info">
            <strong>{{ sub.planName || '套餐' }}</strong>
            <span class="subtext">{{ sub.groupName || '' }} · 到期 {{ formatTime(sub.expiresAt) }}</span>
          </div>
          <n-tag size="small" :type="sub.status === 'active' ? 'success' : 'default'" :bordered="false">
            {{ sub.status === 'active' ? remainLabel(sub) : '已过期' }}
          </n-tag>
        </div>
      </n-card>

      <n-grid :cols="2" :x-gap="18" :y-gap="18" responsive="screen">
        <n-gi>
          <n-card title="钱包流水" :bordered="false">
            <n-data-table :columns="walletColumns" :data="transactions" :bordered="false" size="small" :scroll-x="640" />
          </n-card>
        </n-gi>
        <n-gi>
          <n-card title="近期用量" :bordered="false">
            <n-data-table :columns="usageColumns" :data="usageLogs" :bordered="false" size="small" :scroll-x="620" />
          </n-card>
        </n-gi>
        <n-gi>
          <n-card title="充值订单" :bordered="false">
            <n-data-table :columns="paymentColumns" :data="paymentOrders" :bordered="false" size="small" :scroll-x="520" />
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

    <n-modal v-model:show="showRedeem" preset="card" title="兑换码充值" style="width: 420px">
      <n-form label-placement="top">
        <n-form-item label="兑换码">
          <n-input v-model:value="redeemInput" placeholder="输入兑换码" @keyup.enter="redeem" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showRedeem = false">取消</n-button>
          <n-button type="primary" :loading="redeeming" @click="redeem">兑换</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showStore" preset="card" title="套餐商店" style="width: 560px">
      <p v-if="!storePlans.length" class="sub-empty">暂无可购买的套餐。</p>
      <div v-for="plan in storePlans" :key="plan.id" class="store-card">
        <div class="store-info">
          <strong>{{ plan.name }}</strong>
          <span class="subtext">{{ plan.description || limitLabel(plan) }}</span>
          <span class="subtext">额度：{{ limitLabel(plan) }} · 有效期 {{ plan.validityDays }} 天</span>
        </div>
        <div class="store-buy">
          <strong class="store-price">{{ plan.price > 0 ? `$${plan.price.toFixed(2)}` : '免费' }}</strong>
          <n-button
            size="small"
            type="primary"
            :loading="purchasingId === plan.id"
            @click="purchase(plan)"
          >
            {{ plan.price > 0 ? '余额购买' : '领取' }}
          </n-button>
        </div>
      </div>
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

.sub-empty {
  margin: 0;
  color: rgba(15, 23, 42, 0.5);
  font-size: 13px;
}

.sub-row,
.store-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.sub-row:last-child,
.store-card:last-child {
  border-bottom: none;
}

.sub-info,
.store-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.subtext {
  color: rgba(15, 23, 42, 0.5);
  font-size: 12px;
}

.store-buy {
  display: flex;
  align-items: center;
  gap: 12px;
}

.store-price {
  color: #0f766e;
  font-size: 15px;
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
