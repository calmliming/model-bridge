<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import QRCode from 'qrcode'
import { UiTag } from '../components/ui'
import LazyEChart from '../components/LazyEChart.vue'
import { useBreakpoint } from '../composables/useBreakpoint'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { calendarDayRangeMs, formatTime, formatUsd } from '../utils'
import BrandLogo from '../components/BrandLogo.vue'

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
  errorCategory: string | null
  cost: number
}

interface UserUsageDay {
  day: string
  requests: number
  errors: number
  cost: number
}

interface UserFailureCategory {
  category: string
  count: number
}

interface PaymentOrder {
  id: string
  provider: string
  status: string
  amount: number
  paymentUrl: string | null
  paymentHtml: string | null
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
const router = useRouter()
const { width: viewportWidth } = useBreakpoint()
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
type PaymentProvider = 'manual' | 'alipay' | 'alipay_web' | 'wechat'
const selectedProvider = ref<PaymentProvider>('manual')
const availableProviders = ref<PaymentProvider[]>(['manual'])
const currentPaymentOrder = ref<PaymentOrder | null>(null)
const paymentQrDataUrl = ref('')
const paymentQrLoading = ref(false)
const paymentQrError = ref('')
const queryingPayment = ref(false)
const user = ref<UserMe | null>(null)
const transactions = ref<WalletTransaction[]>([])
const usageLogs = ref<UsageLog[]>([])
const paymentOrders = ref<PaymentOrder[]>([])
const summary = ref<UsageSummary | null>(null)
const dailyUsage = ref<UserUsageDay[]>([])
const failureCategories = ref<UserFailureCategory[]>([])
const recentFailures = ref<UsageLog[]>([])
const dailyLoading = ref(true)
const failuresLoading = ref(true)
const dailyError = ref(false)
const failuresError = ref(false)
const trendDays = ref<7 | 30>(7)
const trendMetric = ref<'cost' | 'requests'>('cost')
const trendRanges = [7, 30] as const

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

const trendRows = computed(() => dailyUsage.value.slice(-trendDays.value))
const compactChart = computed(() => viewportWidth.value < 480)
const chartHeight = computed(() => viewportWidth.value < 640 ? '208px' : '248px')
const todayFailures = computed(() => dailyUsage.value.at(-1)?.errors ?? 0)
const todayRequests = computed(() => dailyUsage.value.at(-1)?.requests ?? 0)
const trendOption = computed(() => ({
  grid: { left: compactChart.value ? 12 : 56, right: compactChart.value ? 10 : 20, top: 20, bottom: 32 },
  tooltip: {
    trigger: 'axis',
    valueFormatter: (value: number) => trendMetric.value === 'cost' ? formatUsd(value) : `${formatNumber(value)} 次`,
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: trendRows.value.map((row) => compactChart.value ? `${Number(row.day.slice(5, 7))}/${Number(row.day.slice(8))}` : row.day.slice(5)),
    axisLine: { lineStyle: { color: '#cbd5e1' } },
    axisLabel: { color: '#64748b', fontSize: 11, interval: compactChart.value ? (trendDays.value === 7 ? 1 : 6) : (trendDays.value === 7 ? 0 : 4) },
  },
  yAxis: {
    type: 'value',
    minInterval: trendMetric.value === 'requests' ? 1 : undefined,
    axisLabel: { show: !compactChart.value, color: '#64748b', fontSize: 11, formatter: (value: number) => trendMetric.value === 'cost' ? `$${value}` : formatNumber(value) },
    splitLine: { lineStyle: { color: '#e2e8f0' } },
  },
  series: [{
    type: 'line',
    data: trendRows.value.map((row) => trendMetric.value === 'cost' ? row.cost : row.requests),
    smooth: true,
    symbol: 'circle',
    symbolSize: trendDays.value === 7 ? 7 : 5,
    showSymbol: true,
    cursor: 'pointer',
    lineStyle: { color: '#0d9488', width: 2 },
    itemStyle: { color: '#0d9488' },
    areaStyle: { color: 'rgba(20, 184, 166, 0.12)' },
  }],
}))

type DashboardNotice = { key: string; title: string; detail: string; action: 'recharge' | 'store' | 'subscription' | 'orders'; actionLabel: string }
const notices = computed<DashboardNotice[]>(() => {
  if (!user.value) return []
  const items: DashboardNotice[] = []
  const now = Date.now()
  const active = subscriptions.value.filter((sub) => sub.status === 'active')
  if (active.length === 0 && user.value.balance < 5) {
    items.push({ key: 'balance', title: user.value.balance <= 0 ? '钱包余额已用尽' : '钱包余额低于 $5', detail: '充值后可继续使用按量计费服务。', action: 'recharge', actionLabel: '去充值' })
  }
  const expiring = active.find((sub) => sub.expiresAt > now && sub.expiresAt <= now + 7 * 86_400_000)
  if (expiring) {
    const daysLeft = Math.ceil((expiring.expiresAt - now) / 86_400_000)
    items.push({ key: 'expiry', title: `${expiring.planName || '订阅'}即将到期`, detail: daysLeft <= 1 ? '将在 24 小时内到期。' : `还有 ${daysLeft} 天到期。`, action: 'store', actionLabel: '查看套餐' })
  }
  const exhausted = active.find((sub) => sub.dailyRemaining === 0 || sub.weeklyRemaining === 0 || sub.monthlyRemaining === 0)
  if (exhausted) {
    items.push({ key: 'quota', title: `${exhausted.planName || '订阅'}额度已用尽`, detail: '查看当前额度或选择其他套餐。', action: 'subscription', actionLabel: '查看订阅' })
  }
  const pendingOrders = paymentOrders.value.filter((order) => order.status === 'pending' && order.expiresAt > now)
  if (pendingOrders.length) {
    items.push({ key: 'orders', title: '最近有充值订单待支付', detail: '请在订单有效期内完成支付。', action: 'orders', actionLabel: '查看订单' })
  }
  return items
})

function handleNotice(action: DashboardNotice['action']) {
  if (action === 'recharge') showRecharge.value = true
  else if (action === 'store') void openStore()
  else document.getElementById(action === 'subscription' ? 'my-subscriptions' : 'payment-orders')?.scrollIntoView({ behavior: 'smooth' })
}

function openFailures() {
  void router.push({ name: 'user-usage', query: { status: 'error' } })
}

function openTrendDay(index: number) {
  const day = trendRows.value[index]?.day
  if (day) void router.push({ name: 'user-usage', query: { from: day, to: day } })
}

async function loadInsights() {
  dailyLoading.value = true
  failuresLoading.value = true
  const [dailyResult, failuresResult] = await Promise.allSettled([
    api.get<{ daily: UserUsageDay[]; failureCategories: UserFailureCategory[] }>('/users/usage/daily', { params: { days: 30 } }),
    api.get<{ logs: UsageLog[] }>('/users/usage', { params: { pageSize: 3, status: 'error' } }),
  ])
  dailyError.value = dailyResult.status === 'rejected'
  failuresError.value = failuresResult.status === 'rejected'
  if (dailyResult.status === 'fulfilled') {
    dailyUsage.value = dailyResult.value.data.daily
    failureCategories.value = dailyResult.value.data.failureCategories
  }
  if (failuresResult.status === 'fulfilled') recentFailures.value = failuresResult.value.data.logs
  dailyLoading.value = false
  failuresLoading.value = false
}

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
  alipay_web: '支付宝网页支付',
  wechat: '微信支付',
}

async function loadUsage() {
  try {
    const params: Record<string, unknown> = { pageSize: 8 }
    if (dateFrom.value) params.startDate = calendarDayRangeMs(dateFrom.value)[0]
    if (dateEnd.value) params.endDate = calendarDayRangeMs(dateEnd.value)[1]
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

    if (selectedProvider.value === 'alipay_web') {
      if (!data.order.paymentHtml) throw new Error('支付表单不可用，请检查支付宝网页支付配置')
      submitAlipayPaymentForm(data.order.paymentHtml)
      return
    }
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

function submitAlipayPaymentForm(paymentHtml: string) {
  const container = document.createElement('div')
  container.innerHTML = paymentHtml
  container.style.position = 'fixed'
  container.style.inset = '0'
  container.style.zIndex = '9999'
  container.style.background = '#fff'
  document.body.appendChild(container)
  const form = container.querySelector<HTMLFormElement>('form')
  if (!form) {
    container.remove()
    throw new Error('支付宝返回的支付表单无效')
  }
  form.submit()
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

async function queryCurrentPayment() {
  const order = currentPaymentOrder.value
  if (!order) return
  queryingPayment.value = true
  try {
    const { data } = await api.post(`/users/payment-orders/${order.id}/query`, {})
    currentPaymentOrder.value = data.order
    if (data.order.status === 'paid') {
      showPaymentQr.value = false
      message.success('支付已确认，充值金额已到账')
    } else {
      message.info('支付宝尚未确认付款，请稍后再试')
    }
    await load()
  } catch (e) {
    message.error(errMsg(e, '查询支付状态失败'))
  } finally {
    queryingPayment.value = false
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

onMounted(() => {
  void load()
  void loadInsights()
})
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

      <UiCard v-if="notices.length" title="待处理事项" class="dashboard-notices" :bordered="false">
        <div class="notice-grid">
          <div v-for="notice in notices" :key="notice.key" class="notice-item">
            <div>
              <strong>{{ notice.title }}</strong>
              <p>{{ notice.detail }}</p>
            </div>
            <button type="button" @click="handleNotice(notice.action)">{{ notice.actionLabel }} →</button>
          </div>
        </div>
      </UiCard>

      <div class="insight-grid">
        <UiCard title="用量趋势" :bordered="false">
          <div class="trend-controls">
            <div class="trend-segment" aria-label="时间范围">
              <button v-for="days in trendRanges" :key="days" type="button" :class="{ active: trendDays === days }" :aria-pressed="trendDays === days" @click="trendDays = days">近{{ days }}天</button>
            </div>
            <div class="trend-segment" aria-label="统计指标">
              <button type="button" :class="{ active: trendMetric === 'cost' }" :aria-pressed="trendMetric === 'cost'" @click="trendMetric = 'cost'">费用</button>
              <button type="button" :class="{ active: trendMetric === 'requests' }" :aria-pressed="trendMetric === 'requests'" @click="trendMetric = 'requests'">请求</button>
            </div>
          </div>
          <div v-if="dailyLoading" class="insight-placeholder">正在加载趋势…</div>
          <div v-else-if="dailyError" class="insight-placeholder">趋势暂时无法加载。</div>
          <div v-else-if="!dailyUsage.some((day) => day.requests > 0)" class="insight-placeholder">近 30 天暂无用量。</div>
          <LazyEChart v-else :option="trendOption" :height="chartHeight" @item-click="openTrendDay" />
          <div class="trend-footer">
            <span v-if="!dailyLoading && !dailyError && dailyUsage.some((day) => day.requests > 0)">点击数据点可查看当天明细</span>
            <button type="button" @click="router.push({ name: 'user-usage' })">查看用量流水 →</button>
          </div>
        </UiCard>
        <UiCard title="失败概览" :bordered="false">
          <div v-if="dailyLoading" class="insight-placeholder short">正在加载失败统计…</div>
          <div v-else-if="dailyError" class="insight-placeholder short">失败统计暂时无法加载。</div>
          <div v-else class="failure-summary">
            <strong>{{ todayFailures }}</strong>
            <span>今日失败请求</span>
            <small v-if="todayRequests">占今日请求的 {{ ((todayFailures / todayRequests) * 100).toFixed(1) }}%</small>
          </div>
          <div v-if="!dailyLoading && !dailyError && failureCategories.length" class="failure-top-category">
            今日主要原因：{{ failureCategories[0]?.category }}（{{ failureCategories[0]?.count }} 次）
          </div>
          <div class="failure-list-head">最近失败</div>
          <div v-if="failuresLoading" class="failure-empty">正在加载记录…</div>
          <div v-else-if="failuresError" class="failure-empty">失败记录暂时无法加载。</div>
          <div v-else-if="!recentFailures.length" class="failure-empty">暂无失败记录。</div>
          <div v-else class="failure-list">
            <div v-for="failure in recentFailures" :key="failure.id" class="failure-row">
              <div>
                <strong>{{ failure.errorCategory || '请求失败' }}</strong>
                <span>{{ failure.model || failure.provider }}</span>
              </div>
              <time>{{ formatTime(failure.ts) }}</time>
            </div>
          </div>
          <button type="button" class="failure-link" @click="openFailures">查看全部失败记录 →</button>
        </UiCard>
      </div>

      <UiCard id="my-subscriptions" title="我的订阅" :bordered="false" style="margin-bottom: 18px">
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
            <p class="table-scroll-hint">左右滑动查看完整记录</p>
          </UiCard>
        </UiGi>
        <UiGi span="2 m:1">
          <UiCard title="近期用量" class="usage-card" :bordered="false">
            <template #header-extra>
              <div class="usage-filter">
                <div class="usage-presets">
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
                <div class="usage-dates">
                  <input type="date" v-model="dateFrom" class="date-input" aria-label="开始日期" />
                  <span class="date-sep">—</span>
                  <input type="date" v-model="dateEnd" class="date-input" aria-label="结束日期" />
                </div>
              </div>
            </template>
            <UiDataTable :columns="usageColumns" :data="usageLogs" :bordered="false" size="small" :scroll-x="620" />
            <p class="table-scroll-hint">左右滑动查看完整记录</p>
          </UiCard>
        </UiGi>
        <UiGi span="2 m:1">
          <UiCard id="payment-orders" title="充值订单" :bordered="false">
            <UiDataTable :columns="paymentColumns" :data="paymentOrders" :bordered="false" size="small" :scroll-x="520" />
            <p class="table-scroll-hint">左右滑动查看完整记录</p>
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
          <BrandLogo :size="38" />
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
          <UiButton type="primary" :loading="queryingPayment" @click="queryCurrentPayment">我已支付，查询状态</UiButton>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.dashboard-notices {
  margin-bottom: 18px;
}

.notice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.notice-item {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #fde68a;
  border-radius: 10px;
  background: #fffbeb;
}

.notice-item strong,
.failure-row strong {
  display: block;
  color: #0f172a;
  font-size: 13px;
}

.notice-item p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 12px;
}

.notice-item button,
.failure-link,
.trend-footer button {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: #0f766e;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.notice-item button:hover,
.failure-link:hover,
.trend-footer button:hover {
  text-decoration: underline;
}

.insight-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr);
  gap: 18px;
  margin-bottom: 18px;
}

.trend-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.trend-segment {
  display: inline-flex;
  gap: 4px;
}

.trend-segment button {
  padding: 4px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  font-size: 12px;
}

.trend-segment button.active {
  @apply border-primary-500 bg-primary-50 text-primary-700;
  font-weight: 700;
}

.trend-segment button:focus-visible,
.notice-item button:focus-visible,
.failure-link:focus-visible,
.trend-footer button:focus-visible {
  @apply outline-none ring-2 ring-primary-500/40;
}

.trend-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  color: #94a3b8;
  font-size: 11px;
}

.trend-footer button {
  margin-left: auto;
}

.insight-placeholder {
  display: grid;
  min-height: 248px;
  place-items: center;
  color: #94a3b8;
  font-size: 13px;
}

.insight-placeholder.short {
  min-height: 80px;
}

.failure-summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e2e8f0;
}

.failure-summary strong {
  color: #dc2626;
  font-size: 30px;
  line-height: 1;
}

.failure-summary span {
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.failure-summary small {
  margin-left: auto;
  color: #94a3b8;
  font-size: 11px;
}

.failure-list-head {
  margin: 14px 0 6px;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.failure-top-category {
  margin-top: 10px;
  color: #64748b;
  font-size: 12px;
}

.failure-list {
  display: grid;
  gap: 0;
}

.failure-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid #f1f5f9;
}

.failure-row span,
.failure-row time,
.failure-empty {
  color: #94a3b8;
  font-size: 11px;
}

.failure-row time {
  flex-shrink: 0;
}

.failure-empty {
  padding: 16px 0;
}

.failure-link {
  display: inline-block;
  margin-top: 12px;
}

:global(.dark) .notice-item {
  border-color: #78350f;
  background: #451a03;
}

:global(.dark) .notice-item strong,
:global(.dark) .failure-row strong {
  color: #f8fafc;
}

:global(.dark) .trend-segment button {
  border-color: #475569;
  background: #1e293b;
  color: #cbd5e1;
}

:global(.dark) .trend-segment button.active {
  @apply border-primary-600 bg-primary-900/30 text-primary-300;
}

:global(.dark) .failure-summary,
:global(.dark) .failure-row {
  border-color: #334155;
}

:global(.dark) .failure-summary span {
  color: #cbd5e1;
}

@media (max-width: 900px) {
  .insight-grid {
    grid-template-columns: 1fr;
  }
}

.usage-filter {
  display: flex;
  flex: 1 1 100%;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.usage-card :deep(.card-header) {
  flex-wrap: wrap;
}

.usage-presets,
.usage-dates {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.table-scroll-hint {
  display: none;
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
  @apply border-primary-500 text-primary-600;
}

.preset-btn.active {
  @apply border-primary-500 bg-primary-500 text-white;
}

.date-input {
  padding: 2px 6px;
  width: 112px;
  min-width: 0;
  border: 1px solid var(--n-border-color, #e5e7eb);
  border-radius: 4px;
  font-size: 11px;
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
  font-variant-numeric: tabular-nums;
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

:global(.dark) .metric-card span,
:global(.dark) .metric-hint,
:global(.dark) .subtext,
:global(.dark) .sub-empty {
  color: #94a3b8;
}

:global(.dark) .metric-card strong,
:global(.dark) .sub-info strong {
  color: #f8fafc;
}

:global(.dark) .metric-card strong.danger {
  color: #f87171;
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }

  .metric-card.is-balance,
  .metric-card:last-child {
    grid-column: 1 / -1;
  }

  .metric-card :deep(.card-body) {
    padding: 12px;
  }

  .metric-card.is-balance :deep(.card-body) {
    padding: 16px;
  }

  .metric-card strong {
    margin-top: 6px;
    font-size: clamp(17px, 5.5vw, 23px);
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .metric-card.is-balance strong {
    font-size: 28px;
  }

  .metric-hint {
    font-size: 11px;
    line-height: 1.35;
  }

  .metric-card :deep(.btn) {
    margin-top: 8px;
  }

  .dashboard-notices,
  .insight-grid {
    margin-bottom: 14px;
  }

  .notice-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .notice-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
  }

  .notice-item strong,
  .notice-item p {
    overflow-wrap: anywhere;
  }

  .notice-item button {
    align-self: center;
    white-space: nowrap;
  }

  .insight-grid {
    gap: 14px;
  }

  .trend-segment {
    flex: 1;
  }

  .trend-segment button {
    flex: 1;
    min-height: 34px;
    padding: 4px 8px;
  }

  .trend-footer span {
    display: none;
  }

  .failure-summary {
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  .failure-summary small {
    width: 100%;
    margin-left: 0;
  }

  .failure-row > div {
    flex: 1;
    min-width: 0;
  }

  .failure-row strong,
  .failure-row span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub-row,
  .store-card {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .sub-info,
  .store-info {
    min-width: 0;
    max-width: 100%;
  }

  .subtext {
    overflow-wrap: anywhere;
  }

  .sub-row :deep(.badge) {
    max-width: 100%;
    white-space: normal;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .store-buy {
    justify-content: space-between;
    width: 100%;
  }

  .usage-filter {
    justify-content: flex-start;
    width: 100%;
  }

  .usage-presets {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
  }

  .usage-dates {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    width: 100%;
  }

  .preset-btn {
    min-height: 34px;
    padding: 4px 6px;
  }

  .date-input {
    width: 100%;
    min-height: 34px;
    font-size: 12px;
  }

  .table-scroll-hint {
    display: block;
    margin: 8px 0 0;
    color: #94a3b8;
    font-size: 11px;
    text-align: right;
  }
}
</style>
