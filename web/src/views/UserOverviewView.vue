<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { UiTag } from '../components/ui'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
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

interface UsageSummary {
  requests24h: number
  tokens24h: number
  cost24h: number
  requests30d: number
  tokens30d: number
  cost30d: number
  requestsTotal: number
  success30d: number
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
const paymentQrDataUrl = ref('')
const paymentQrLoading = ref(false)
const paymentQrError = ref('')
const user = ref<UserMe | null>(null)
const transactions = ref<WalletTransaction[]>([])
const usageLogs = ref<UsageLog[]>([])
const paymentOrders = ref<PaymentOrder[]>([])
const summary = ref<UsageSummary | null>(null)

// Date filter for usage logs
const dateFrom = ref<string>('')
const dateEnd = ref<string>('')

const datePresets = [
  { label: '全部', value: null as null | [string, string] },
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

function pad2(v: number) { return String(v).padStart(2, '0') }

function toStartOfDayMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00.000`).getTime()
}

function toEndOfDayMs(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59.999`).getTime()
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

const emptySummary: UsageSummary = {
  requests24h: 0,
  tokens24h: 0,
  cost24h: 0,
  requests30d: 0,
  tokens30d: 0,
  cost30d: 0,
  requestsTotal: 0,
  success30d: 0,
}

const stat = computed(() => summary.value ?? emptySummary)

const successRate30d = computed(() => {
  const { requests30d, success30d } = stat.value
  if (requests30d <= 0) return null
  return (success30d / requests30d) * 100
})

const activeSubscriptions = computed(
  () => subscriptions.value.filter((s) => s.status === 'active').length,
)

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

const metricCards = computed(() => [
  {
    label: '今日请求',
    value: formatNumber(stat.value.requests24h),
    hint: `累计 ${formatNumber(stat.value.requestsTotal)} 次`,
    tone: 'violet',
  },
  {
    label: '今日 Tokens',
    value: formatNumber(stat.value.tokens24h),
    hint: `费用 ${formatUsd(stat.value.cost24h)}`,
    tone: 'indigo',
  },
  {
    label: '今日费用',
    value: formatUsd(stat.value.cost24h),
    hint: `${formatNumber(stat.value.tokens24h)} tokens`,
    tone: 'rose',
  },
  {
    label: '30天 费用',
    value: formatUsd(stat.value.cost30d),
    hint: `${formatNumber(stat.value.requests30d)} 次 · ${formatNumber(stat.value.tokens30d)} tokens`,
    tone: 'amber',
  },
  {
    label: '30天 成功率',
    value: successRate30d.value == null ? '—' : `${successRate30d.value.toFixed(1)}%`,
    hint:
      successRate30d.value == null
        ? '暂无请求'
        : `成功 ${formatNumber(stat.value.success30d)} / ${formatNumber(stat.value.requests30d)}`,
    tone: 'teal',
  },
])

const providerLabels: Record<string, string> = {
  manual: '线下转账',
  alipay: '支付宝',
  wechat: '微信支付',
}

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

async function loadUsage() {
  try {
    const params: Record<string, unknown> = { pageSize: 8 }
    if (dateFrom.value) params.startDate = toStartOfDayMs(dateFrom.value)
    if (dateEnd.value) params.endDate = toEndOfDayMs(dateEnd.value)
    const usageRes = await api.get('/users/usage', { params })
    usageLogs.value = usageRes.data.logs
  } catch (e) {
    message.error(errMsg(e))
  }
}

async function load() {
  loading.value = true
  try {
    const [walletRes, ordersRes, providersRes, subsRes, summaryRes] = await Promise.all([
      api.get('/users/wallet'),
      api.get('/users/payment-orders', { params: { pageSize: 8 } }),
      api.get('/users/payment-providers'),
      api.get('/users/subscriptions'),
      api.get('/users/usage/summary'),
    ])
    user.value = walletRes.data.user
    transactions.value = walletRes.data.transactions
    paymentOrders.value = ordersRes.data.orders
    if (currentPaymentOrder.value) {
      const refreshed = paymentOrders.value.find((order) => order.id === currentPaymentOrder.value?.id)
      if (refreshed) {
        const becamePaid = currentPaymentOrder.value.status !== 'paid' && refreshed.status === 'paid'
        currentPaymentOrder.value = refreshed
        if (becamePaid) {
          showPaymentQr.value = false
          message.success('支付已确认，充值金额已到账')
        }
      }
    }
    availableProviders.value = providersRes.data.providers
    subscriptions.value = subsRes.data.subscriptions
    summary.value = summaryRes.data
    if (availableProviders.value.length > 0) {
      selectedProvider.value = availableProviders.value[0]!
    }
    await loadUsage()
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

watch([dateFrom, dateEnd], () => {
  loadUsage()
})

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
      await generatePaymentQr(data.order)
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

async function generatePaymentQr(order: PaymentOrder) {
  paymentQrDataUrl.value = ''
  paymentQrError.value = ''
  if (!order.paymentUrl) {
    paymentQrError.value = '支付链接不可用，请重新创建订单'
    return
  }
  paymentQrLoading.value = true
  try {
    paymentQrDataUrl.value = await QRCode.toDataURL(order.paymentUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' },
    })
  } catch {
    paymentQrError.value = '二维码生成失败，请打开支付链接完成付款'
  } finally {
    paymentQrLoading.value = false
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

const walletColumns: TableColumn<WalletTransaction>[] = [
  { title: '时间', key: 'createdAt', minWidth: 140, render: (row) => formatTime(row.createdAt) },
  { title: '类型', key: 'type', width: 90 },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('span', { class: row.amount < 0 ? 'danger' : 'amount' }, formatUsd(row.amount)) },
  { title: '余额', key: 'balanceAfter', width: 110, render: (row) => formatUsd(row.balanceAfter) },
  { title: '备注', key: 'note', minWidth: 160, render: (row) => row.note || '—' },
]

const usageColumns: TableColumn<UsageLog>[] = [
  { title: '时间', key: 'ts', minWidth: 140, render: (row) => formatTime(row.ts) },
  { title: '服务商', key: 'provider', width: 90 },
  { title: '模型', key: 'model', minWidth: 160, render: (row) => row.model || '—' },
  { title: '成本', key: 'cost', width: 100, render: (row) => formatUsd(row.cost) },
  { title: '状态', key: 'status', width: 90, render: (row) => h(UiTag, { size: 'small', bordered: false, type: row.status === 'success' ? 'success' : 'error' }, { default: () => row.status }) },
]

const paymentColumns: TableColumn<PaymentOrder>[] = [
  { title: '时间', key: 'createdAt', minWidth: 140, render: (row) => formatTime(row.createdAt) },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('span', { class: 'amount' }, formatUsd(row.amount)) },
  { title: '状态', key: 'status', width: 90, render: (row) => h(UiTag, { size: 'small', bordered: false, type: row.status === 'paid' ? 'success' : row.status === 'pending' ? 'warning' : 'default' }, { default: () => row.status }) },
  { title: '入账时间', key: 'paidAt', minWidth: 140, render: (row) => row.paidAt ? formatTime(row.paidAt) : '—' },
]

onMounted(load)
</script>

<template>
  <div>
    <UiSpin :show="loading">
      <div class="metric-grid">
        <UiCard class="metric-card is-balance" :bordered="false">
          <span>钱包余额</span>
          <strong :class="{ danger: (user?.balance ?? 0) <= 0 }">{{ formatUsd(user?.balance ?? 0) }}</strong>
          <small class="metric-hint">{{ activeSubscriptions }} 个生效订阅</small>
          <UiSpace :size="8">
            <UiButton size="small" secondary type="primary" @click="showRecharge = true">充值</UiButton>
            <UiButton size="small" secondary @click="showRedeem = true">兑换码</UiButton>
          </UiSpace>
        </UiCard>
        <UiCard
          v-for="card in metricCards"
          :key="card.label"
          class="metric-card"
          :class="`is-${card.tone}`"
          :bordered="false"
        >
          <span>{{ card.label }}</span>
          <strong>{{ loading ? '—' : card.value }}</strong>
          <small class="metric-hint">{{ card.hint }}</small>
        </UiCard>
      </div>

      <UiCard title="我的订阅" :bordered="false" style="margin-bottom: 18px">
        <template #header-extra>
          <UiButton size="small" secondary type="primary" @click="openStore">套餐商店</UiButton>
        </template>
        <p v-if="!subscriptions.length" class="sub-empty">
          暂无订阅。可在「套餐商店」用余额开通，或联系管理员分配。
        </p>
        <div v-for="sub in subscriptions" :key="sub.id" class="sub-row">
          <div class="sub-info">
            <strong>{{ sub.planName || '套餐' }}</strong>
            <span class="subtext">{{ sub.groupName || '' }} · 到期 {{ formatTime(sub.expiresAt) }}</span>
          </div>
          <UiTag size="small" :type="sub.status === 'active' ? 'success' : 'default'" :bordered="false">
            {{ sub.status === 'active' ? remainLabel(sub) : '已过期' }}
          </UiTag>
        </div>
      </UiCard>

      <UiGrid :cols="2" :x-gap="18" :y-gap="18" responsive="screen">
        <UiGi span="2 m:1">
          <UiCard title="钱包流水" :bordered="false">
            <UiDataTable :columns="walletColumns" :data="transactions" :bordered="false" size="small" :scroll-x="640" />
          </UiCard>
        </UiGi>
        <UiGi span="2 m:1">
          <UiCard title="近期用量" :bordered="false">
            <template #header-extra>
              <div class="usage-filter">
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
                <input type="date" v-model="dateFrom" class="date-input" title="开始日期" />
                <span class="date-sep">—</span>
                <input type="date" v-model="dateEnd" class="date-input" title="结束日期" />
              </div>
            </template>
            <UiDataTable :columns="usageColumns" :data="usageLogs" :bordered="false" size="small" :scroll-x="620" />
          </UiCard>
        </UiGi>
        <UiGi span="2 m:1">
          <UiCard title="充值订单" :bordered="false">
            <UiDataTable :columns="paymentColumns" :data="paymentOrders" :bordered="false" size="small" :scroll-x="520" />
          </UiCard>
        </UiGi>
      </UiGrid>
    </UiSpin>

    <UiModal v-model:show="showRecharge" title="发起充值" :width="420">
      <UiForm label-placement="top">
        <UiFormItem label="充值金额（USD）">
          <UiInputNumber v-model:value="rechargeAmount" :min="0.01" :precision="2" style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="支付方式">
          <UiRadioGroup v-model:value="selectedProvider">
            <UiSpace vertical>
              <UiRadio v-for="p in availableProviders" :key="p" :value="p">
                {{ providerLabels[p] }}
              </UiRadio>
            </UiSpace>
          </UiRadioGroup>
        </UiFormItem>
      </UiForm>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showRecharge = false">取消</UiButton>
          <UiButton type="primary" :loading="creatingOrder" @click="createRechargeOrder">创建订单</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal v-model:show="showRedeem" title="兑换码充值" :width="420">
      <UiForm label-placement="top">
        <UiFormItem label="兑换码">
          <UiInput v-model:value="redeemInput" placeholder="输入兑换码" @keyup.enter="redeem" />
        </UiFormItem>
      </UiForm>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showRedeem = false">取消</UiButton>
          <UiButton type="primary" :loading="redeeming" @click="redeem">兑换</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal v-model:show="showStore" title="套餐商店" :width="560">
      <p v-if="!storePlans.length" class="sub-empty">暂无可购买的套餐。</p>
      <div v-for="plan in storePlans" :key="plan.id" class="store-card">
        <div class="store-info">
          <strong>{{ plan.name }}</strong>
          <span class="subtext">{{ plan.description || limitLabel(plan) }}</span>
          <span class="subtext">额度：{{ limitLabel(plan) }} · 有效期 {{ plan.validityDays }} 天</span>
        </div>
        <div class="store-buy">
          <strong class="store-price">{{ plan.price > 0 ? `$${plan.price.toFixed(2)}` : '免费' }}</strong>
          <UiButton
            size="small"
            type="primary"
            :loading="purchasingId === plan.id"
            @click="purchase(plan)"
          >
            {{ plan.price > 0 ? '余额购买' : '领取' }}
          </UiButton>
        </div>
      </div>
    </UiModal>

    <UiModal v-model:show="showPaymentQr" title="账户充值" :width="520">
      <div
        v-if="currentPaymentOrder"
        class="checkout"
        :class="`checkout--${currentPaymentOrder.provider}`"
      >
        <div class="checkout-brand">
          <span class="checkout-logo">MB</span>
          <span>
            <strong>Model Bridge</strong>
            <small>平台账户充值</small>
          </span>
          <UiTag size="small" type="success" :bordered="false">安全收银台</UiTag>
        </div>

        <div class="checkout-summary">
          <span>应付金额</span>
          <strong>{{ formatUsd(currentPaymentOrder.amount) }}</strong>
          <small>{{ providerLabels[currentPaymentOrder.provider] }}扫码支付</small>
        </div>

        <div class="checkout-qr-stage">
          <div class="checkout-qr-frame" :aria-busy="paymentQrLoading">
            <span v-if="paymentQrLoading" class="spinner h-7 w-7" />
            <img
              v-else-if="paymentQrDataUrl"
              :src="paymentQrDataUrl"
              :alt="`${providerLabels[currentPaymentOrder.provider]}支付二维码`"
            >
            <div v-else class="checkout-qr-error">
              <strong>二维码暂不可用</strong>
              <span>{{ paymentQrError }}</span>
              <a
                v-if="currentPaymentOrder.paymentUrl"
                :href="currentPaymentOrder.paymentUrl"
                target="_blank"
                rel="noopener noreferrer"
              >打开支付页面</a>
            </div>
          </div>
          <p>使用{{ providerLabels[currentPaymentOrder.provider] }}扫描二维码完成付款</p>
        </div>

        <dl class="checkout-details">
          <div>
            <dt>订单号</dt>
            <dd>{{ currentPaymentOrder.id }}</dd>
          </div>
          <div>
            <dt>有效期至</dt>
            <dd>{{ formatTime(currentPaymentOrder.expiresAt) }}</dd>
          </div>
        </dl>

        <div class="checkout-notice">
          支付结果由订单系统核验，到账前请勿重复支付。
        </div>
      </div>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showPaymentQr = false">稍后支付</UiButton>
          <UiButton type="primary" @click="load">我已支付，刷新状态</UiButton>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.usage-filter {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.preset-btn {
  padding: 2px 8px;
  border: 1px solid var(--n-border-color, #e5e7eb);
  border-radius: 4px;
  background: var(--n-color, #fff);
  color: var(--n-text-color-2, #6b7280);
  font-size: 11px;
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

.date-input {
  padding: 2px 6px;
  border: 1px solid var(--n-border-color, #e5e7eb);
  border-radius: 4px;
  font-size: 11px;
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
  font-size: 11px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}

.metric-card {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
}

.metric-card::after {
  content: '';
  position: absolute;
  width: 80px;
  height: 80px;
  right: -24px;
  top: -24px;
  border-radius: 999px;
  background: #94a3b8;
  opacity: 0.14;
}

.metric-card.is-balance::after {
  background: #16a34a;
}

.metric-card.is-violet::after {
  background: #8b5cf6;
}

.metric-card.is-indigo::after {
  background: #6366f1;
}

.metric-card.is-rose::after {
  background: #f43f5e;
}

.metric-card.is-amber::after {
  background: #f59e0b;
}

.metric-card.is-teal::after {
  background: #0d9488;
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

.metric-hint {
  display: block;
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.42);
  font-size: 12px;
}

.metric-card :deep(.btn) {
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

.checkout {
  --checkout-accent: #1677ff;
  overflow: hidden;
  border-top: 3px solid var(--checkout-accent);
  background: #f8fafc;
}

.checkout--wechat {
  --checkout-accent: #07c160;
}

.checkout-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
  text-align: left;
}

.checkout-brand > span:nth-child(2) {
  min-width: 0;
  flex: 1;
}

.checkout-brand strong,
.checkout-brand small {
  display: block;
  letter-spacing: 0;
}

.checkout-brand strong {
  color: #111827;
  font-size: 14px;
}

.checkout-brand small {
  margin-top: 1px;
  color: #6b7280;
  font-size: 12px;
}

.checkout-logo {
  display: inline-flex;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}

.checkout-summary {
  padding: 20px 18px 12px;
  text-align: center;
}

.checkout-summary span,
.checkout-summary small {
  display: block;
  color: #6b7280;
  font-size: 12px;
}

.checkout-summary strong {
  display: block;
  margin: 4px 0;
  color: #111827;
  font-size: 30px;
  line-height: 1.2;
  letter-spacing: 0;
}

.checkout-qr-stage {
  padding: 8px 18px 16px;
  text-align: center;
}

.checkout-qr-frame {
  display: flex;
  width: min(272px, 100%);
  aspect-ratio: 1;
  margin: 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}

.checkout-qr-frame img {
  display: block;
  width: calc(100% - 20px);
  height: calc(100% - 20px);
}

.checkout-qr-stage p {
  margin: 10px 0 0;
  color: #4b5563;
  font-size: 13px;
}

.checkout-qr-error {
  display: flex;
  max-width: 210px;
  flex-direction: column;
  gap: 8px;
  color: #6b7280;
  font-size: 12px;
}

.checkout-qr-error strong {
  color: #374151;
  font-size: 14px;
}

.checkout-qr-error a {
  color: var(--checkout-accent);
  font-weight: 600;
}

.checkout-details {
  margin: 0;
  padding: 0 18px 14px;
}

.checkout-details div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 10px;
  padding: 6px 0;
  font-size: 12px;
}

.checkout-details dt {
  color: #9ca3af;
}

.checkout-details dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: #4b5563;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.checkout-notice {
  padding: 11px 18px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
  color: #6b7280;
  font-size: 12px;
  text-align: center;
}

:global(.dark) .checkout {
  background: #0f172a;
}

:global(.dark) .checkout-brand,
:global(.dark) .checkout-notice {
  border-color: #334155;
  background: #1e293b;
}

:global(.dark) .checkout-brand strong,
:global(.dark) .checkout-summary strong {
  color: #f8fafc;
}

:global(.dark) .checkout-brand small,
:global(.dark) .checkout-summary span,
:global(.dark) .checkout-summary small,
:global(.dark) .checkout-qr-stage p,
:global(.dark) .checkout-details dd,
:global(.dark) .checkout-notice {
  color: #94a3b8;
}

@media (max-width: 980px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .metric-grid {
    grid-template-columns: 1fr;
  }
}
</style>
