<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { UiButton, UiSpace, UiTag, UiTooltip } from '../components/ui'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { formatTime, formatUsd } from '../utils'

interface UserRow {
  id: string
  email: string
  name: string
  status: 'active' | 'disabled'
  concurrencyLimit: number | null
  balance: number
  acceptedAt: number | null
  lastLoginAt: number | null
  createdAt: number
  keyCount: number
  requestCount: number
  totalCost: number
  isAdmin: boolean
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

interface UsageLog {
  id: string
  ts: number
  provider: string
  model: string | null
  status: string
  firstTokenMs: number | null
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  cost: number
  apiKeyName: string | null
}

const message = useMessage()
const users = ref<UserRow[]>([])
const loading = ref(true)
const search = ref('')
const statusFilter = ref('all')
const managedUser = ref<UserRow | null>(null)
const filteredUsers = computed(() => users.value.filter(row => `${row.name} ${row.email}`.toLowerCase().includes(search.value.trim().toLowerCase()) && (statusFilter.value === 'all' || row.status === statusFilter.value)))
const showInvite = ref(false)
const inviting = ref(false)
const inviteForm = ref({ email: '', name: '' })
const inviteResult = ref<{
  token: string
  inviteUrl: string
  expiresAt: number
} | null>(null)

const showAdjust = ref(false)
const adjusting = ref(false)
const selectedUser = ref<UserRow | null>(null)
const adjustForm = ref({ amount: 10, note: '' })
const adjustDirection = ref<1 | -1>(1)
const signedAmount = computed(() => adjustDirection.value * (Number(adjustForm.value.amount) || 0))
const adjustedBalance = computed(() => (selectedUser.value?.balance || 0) + signedAmount.value)

const showConcurrency = ref(false)
const savingConcurrency = ref(false)
const concurrencyForm = ref<{ value: number | null }>({ value: null })

const showWallet = ref(false)
const walletLoading = ref(false)
const walletRows = ref<WalletTransaction[]>([])

const showUsage = ref(false)
const usageLoading = ref(false)
const usageRows = ref<UsageLog[]>([])

const showSubs = ref(false)
const subsLoading = ref(false)
const subsRows = ref<
  Array<{
    id: string
    planName: string | null
    groupName: string | null
    status: string
    expiresAt: number
  }>
>([])
const subPlans = ref<Array<{ id: string; name: string; groupName: string | null }>>([])
const assignPlanId = ref<string | null>(null)
const assigning = ref(false)
const subPlanOptions = computed(() =>
  subPlans.value.map((p) => ({
    label: p.groupName ? `${p.name}（${p.groupName}）` : p.name,
    value: p.id
  }))
)

async function openSubscriptions(row: UserRow) {
  selectedUser.value = row
  showSubs.value = true
  subsLoading.value = true
  assignPlanId.value = null
  try {
    const [subsRes, plansRes] = await Promise.all([api.get(`/admin/users/${row.id}/subscriptions`), api.get('/admin/subscription-plans')])
    subsRows.value = subsRes.data.subscriptions
    subPlans.value = plansRes.data.plans
    assignPlanId.value = subPlans.value[0]?.id ?? null
  } catch (e) {
    message.error(errMsg(e, '加载订阅失败'))
  } finally {
    subsLoading.value = false
  }
}

async function assignSubscription() {
  if (!selectedUser.value || !assignPlanId.value) {
    message.warning('请选择套餐')
    return
  }
  assigning.value = true
  try {
    await api.post(`/admin/users/${selectedUser.value.id}/subscriptions`, {
      planId: assignPlanId.value
    })
    message.success('已分配订阅')
    const { data } = await api.get(`/admin/users/${selectedUser.value.id}/subscriptions`)
    subsRows.value = data.subscriptions
  } catch (e) {
    message.error(errMsg(e, '分配失败'))
  } finally {
    assigning.value = false
  }
}

function formatTokens(row: UsageLog) {
  const total = row.inputTokens + row.outputTokens + row.cacheCreateTokens + row.cacheReadTokens
  const rows: [string, number][] = [
    ['输入', row.inputTokens],
    ['输出', row.outputTokens],
    ['缓存写入', row.cacheCreateTokens],
    ['缓存读取', row.cacheReadTokens]
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

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/users')
    users.value = data.users
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

async function invite() {
  if (!inviteForm.value.email.trim()) {
    message.warning('请填写邮箱')
    return
  }
  inviting.value = true
  try {
    const { data } = await api.post('/admin/users/invite', {
      email: inviteForm.value.email.trim(),
      name: inviteForm.value.name.trim() || undefined
    })
    inviteResult.value = {
      token: data.token,
      inviteUrl: data.inviteUrl,
      expiresAt: data.expiresAt
    }
    inviteForm.value = { email: '', name: '' }
    showInvite.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '邀请失败'))
  } finally {
    inviting.value = false
  }
}

async function resetInvite(row: UserRow) {
  try {
    const { data } = await api.post('/admin/users/invite', {
      email: row.email,
      name: row.name
    })
    inviteResult.value = {
      token: data.token,
      inviteUrl: data.inviteUrl,
      expiresAt: data.expiresAt
    }
    message.success('已生成重置链接')
    await load()
  } catch (e) {
    message.error(errMsg(e, '生成重置链接失败'))
  }
}

async function updateStatus(row: UserRow) {
  try {
    await api.patch(`/admin/users/${row.id}`, {
      status: row.status === 'active' ? 'disabled' : 'active'
    })
    await load()
  } catch (e) {
    message.error(errMsg(e))
  }
}

function openAdjust(row: UserRow, sign: 1 | -1) {
  selectedUser.value = row
  adjustDirection.value = sign
  adjustForm.value = { amount: 10, note: '' }
  showAdjust.value = true
}

function openConcurrency(row: UserRow) {
  selectedUser.value = row
  concurrencyForm.value = { value: row.concurrencyLimit }
  showConcurrency.value = true
}

async function saveConcurrency() {
  if (!selectedUser.value) return
  const raw = concurrencyForm.value.value
  // Empty or non-positive clears the limit (unlimited).
  const limit = raw != null && raw > 0 ? Math.floor(raw) : null
  savingConcurrency.value = true
  try {
    await api.patch(`/admin/users/${selectedUser.value.id}`, {
      concurrencyLimit: limit
    })
    message.success('已更新并发上限')
    showConcurrency.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '更新并发上限失败'))
  } finally {
    savingConcurrency.value = false
  }
}

async function adjustWallet() {
  if (!selectedUser.value || adjusting.value) return
  if (!Number.isFinite(adjustForm.value.amount) || adjustForm.value.amount <= 0) { message.warning('请输入大于 0 的金额'); return }
  adjusting.value = true
  try {
    await api.post(`/admin/users/${selectedUser.value.id}/wallet`, {
      amount: signedAmount.value,
      note: adjustForm.value.note.trim() || undefined
    })
    message.success('已更新余额')
    showAdjust.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '余额调整失败'))
  } finally {
    adjusting.value = false
  }
}

async function openWallet(row: UserRow) {
  selectedUser.value = row
  showWallet.value = true
  walletLoading.value = true
  try {
    const { data } = await api.get(`/admin/users/${row.id}/wallet`, {
      params: { pageSize: 50 }
    })
    walletRows.value = data.transactions
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    walletLoading.value = false
  }
}

async function openUsage(row: UserRow) {
  selectedUser.value = row
  showUsage.value = true
  usageLoading.value = true
  try {
    const { data } = await api.get(`/admin/users/${row.id}/usage`, {
      params: { pageSize: 50 }
    })
    usageRows.value = data.logs
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    usageLoading.value = false
  }
}

async function copyInvite() {
  if (!inviteResult.value) return
  await navigator.clipboard?.writeText(inviteResult.value.inviteUrl)
  message.success('已复制邀请链接')
}

function renderStatus(row: UserRow) {
  if (!row.acceptedAt) {
    return h(UiTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '待接受' })
  }
  return h(
    UiTag,
    {
      size: 'small',
      bordered: false,
      type: row.status === 'active' ? 'success' : 'error'
    },
    { default: () => (row.status === 'active' ? '启用' : '禁用') }
  )
}

const columns = computed<TableColumn<UserRow>[]>(() => [
  {
    title: '用户',
    key: 'user',
    minWidth: 210,
    render: (row) =>
      h('div', [h('div', { class: 'user-title' }, [h('strong', row.name), row.isAdmin ? h(UiTag, { size: 'small', type: 'info', bordered: false }, { default: () => 'Admin' }) : null]), h('span', { class: 'subtext' }, row.email)])
  },
  {
    title: '余额',
    key: 'balance',
    minWidth: 96,
    render: (row) => h('span', { class: row.balance <= 0 ? 'danger' : 'amount' }, formatUsd(row.balance))
  },
  {
    title: '并发',
    key: 'concurrencyLimit',
    width: 72,
    render: (row) => (row.concurrencyLimit == null ? h('span', { class: 'subtext' }, '不限') : row.concurrencyLimit)
  },
  { title: 'Keys', key: 'keyCount', width: 72 },
  {
    title: '请求',
    key: 'requestCount',
    width: 80,
    render: (row) => row.requestCount.toLocaleString('en-US')
  },
  {
    title: '成本',
    key: 'totalCost',
    width: 96,
    render: (row) => formatUsd(row.totalCost)
  },
  { title: '状态', key: 'status', width: 92, render: renderStatus },
  {
    title: '最后登录',
    key: 'lastLoginAt',
    minWidth: 140,
    render: (row) => formatTime(row.lastLoginAt)
  },
  {
    title: '创建',
    key: 'createdAt',
    minWidth: 140,
    render: (row) => formatTime(row.createdAt)
  },
  { title: '操作', key: 'actions', width: 96, fixed: 'right',
    render: row => h(UiButton, { size: 'small', secondary: true, onClick: () => { managedUser.value = row } }, { default: () => '查看' }),
  }
])

function manageUser(action: 'credit' | 'debit' | 'wallet' | 'usage' | 'subscriptions' | 'concurrency' | 'password' | 'status') {
  const row = managedUser.value
  if (!row) return
  managedUser.value = null
  if (action === 'credit' || action === 'debit') openAdjust(row, action === 'credit' ? 1 : -1)
  else if (action === 'wallet') void openWallet(row)
  else if (action === 'usage') void openUsage(row)
  else if (action === 'subscriptions') void openSubscriptions(row)
  else if (action === 'concurrency') openConcurrency(row)
  else if (action === 'password') void resetInvite(row)
  else void updateStatus(row)
}

const walletColumns: TableColumn<WalletTransaction>[] = [
  {
    title: '时间',
    key: 'createdAt',
    minWidth: 150,
    render: (row) => formatTime(row.createdAt)
  },
  { title: '类型', key: 'type', width: 90 },
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
    render: (row) => row.note || '—'
  }
]

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
    minWidth: 120,
    render: (row) => row.apiKeyName || '—'
  },
  { title: '服务商', key: 'provider', width: 90 },
  {
    title: '模型',
    key: 'model',
    minWidth: 160,
    render: (row) => row.model || '—'
  },
  { title: 'Tokens', key: 'tokens', width: 100, render: formatTokens },
  {
    title: '成本',
    key: 'cost',
    width: 100,
    render: (row) => formatUsd(row.cost)
  },
  {
    title: '首字',
    key: 'firstTokenMs',
    width: 90,
    render: (row) => (row.firstTokenMs == null ? '—' : `${row.firstTokenMs}ms`)
  },
  { title: '状态', key: 'status', width: 90 }
]

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div class="flex min-w-0 flex-1 flex-wrap gap-3"><UiInput v-model:value="search" aria-label="搜索用户" placeholder="搜索名称或邮箱" class="!w-full sm:!w-72" /><select v-model="statusFilter" class="input !w-auto" aria-label="用户状态"><option value="all">全部用户</option><option value="active">启用</option><option value="disabled">禁用</option></select></div>
      <UiButton type="primary" @click="showInvite = true">邀请用户</UiButton>
    </div>

    <UiCard class="table-card hidden md:block" :bordered="false">
      <UiDataTable :columns="columns" :data="filteredUsers" :loading="loading" :bordered="false" :scroll-x="1100" empty-text="暂无符合条件的用户" />
    </UiCard>

    <div class="grid gap-3 md:hidden">
      <p v-if="loading" role="status" class="py-8 text-center text-sm text-gray-500">正在加载用户…</p>
      <p v-else-if="!filteredUsers.length" class="card p-6 text-center text-sm text-gray-500">暂无符合条件的用户</p>
      <article v-for="row in filteredUsers" :key="row.id" class="card min-w-0 p-4"><div class="flex justify-between gap-3"><h2 class="min-w-0 break-words font-semibold">{{ row.name }}</h2><UiTag :type="row.status === 'active' ? 'success' : 'default'">{{ row.status === 'active' ? '启用' : '禁用' }}</UiTag></div><p class="mt-2 break-all text-xs text-gray-500">{{ row.email }}</p><div class="mt-4 flex items-end justify-between gap-3"><div><p class="text-xs text-gray-500">钱包余额</p><strong class="text-xl">{{ formatUsd(row.balance) }}</strong><p class="mt-2 text-xs text-gray-500">{{ row.keyCount }} 个 Key · {{ row.requestCount }} 次请求</p></div><UiButton secondary size="small" @click="managedUser = row">用户详情</UiButton></div></article>
    </div>
    <UiModal :show="!!managedUser" :title="managedUser?.name || '用户详情'" :width="560" @update:show="(shown: boolean) => { if (!shown) managedUser = null }">
      <template v-if="managedUser"><p class="break-all text-sm text-gray-500">{{ managedUser.email }}</p><div class="my-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 text-sm dark:bg-dark-900"><div><span class="text-gray-500">钱包余额</span><strong class="mt-1 block text-xl">{{ formatUsd(managedUser.balance) }}</strong></div><div><span class="text-gray-500">累计请求</span><strong class="mt-1 block text-xl">{{ managedUser.requestCount }}</strong></div></div>
        <h3 class="mb-3 text-sm font-semibold">钱包与消费</h3><div class="grid grid-cols-2 gap-3"><UiButton secondary @click="manageUser('credit')">充值</UiButton><UiButton secondary @click="manageUser('debit')">扣款</UiButton><UiButton secondary @click="manageUser('wallet')">钱包流水</UiButton><UiButton secondary @click="manageUser('usage')">用量记录</UiButton><UiButton secondary @click="manageUser('subscriptions')">订阅套餐</UiButton></div>
        <details class="mt-5 border-t border-gray-100 pt-4 dark:border-dark-700"><summary class="cursor-pointer text-sm font-semibold">账号管理</summary><div class="mt-3 flex flex-wrap gap-3"><UiButton secondary @click="manageUser('concurrency')">并发限制</UiButton><UiButton secondary @click="manageUser('password')">生成重置密码链接</UiButton><UiButton :type="managedUser.status === 'active' ? 'error' : 'success'" quaternary @click="manageUser('status')">{{ managedUser.status === 'active' ? '禁用用户' : '启用用户' }}</UiButton></div></details>
      </template>
    </UiModal>

    <UiModal v-model:show="showInvite" title="邀请用户" :width="460">
      <UiForm label-placement="top" @submit="invite">
        <UiFormItem label="邮箱">
          <UiInput v-model:value="inviteForm.email" placeholder="user@example.com" />
        </UiFormItem>
        <UiFormItem label="名称">
          <UiInput v-model:value="inviteForm.name" placeholder="可留空" />
        </UiFormItem>
      </UiForm>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showInvite = false">取消</UiButton>
          <UiButton type="primary" :loading="inviting" @click="invite">生成邀请</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal
      :show="!!inviteResult"
      title="邀请 / 重置链接"
      :width="560"
      @update:show="
        (shown: boolean) => {
          if (!shown) inviteResult = null
        }
      "
    >
      <UiAlert type="warning" style="margin-bottom: 12px">链接只在这里显示一次，用户打开后可设置新密码。</UiAlert>
      <UiInput :value="inviteResult?.inviteUrl ?? ''" readonly />
      <div class="subline">过期时间：{{ formatTime(inviteResult?.expiresAt) }}</div>
      <template #footer>
        <UiSpace justify="end">
          <UiButton type="primary" @click="copyInvite">复制链接</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal v-model:show="showAdjust" :title="`${adjustDirection === 1 ? '充值' : '扣款'}：${selectedUser?.name ?? ''}`" :width="460">
      <UiForm label-placement="top" @submit="adjustWallet">
        <UiFormItem label="金额（USD）">
          <UiInputNumber v-model:value="adjustForm.amount" :min="0.01" :step="1" style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="备注">
          <UiInput v-model:value="adjustForm.note" placeholder="可留空" />
        </UiFormItem>
      </UiForm>
      <div class="mt-4 rounded-xl bg-gray-50 p-3 text-sm dark:bg-dark-900"><p>当前余额：{{ formatUsd(selectedUser?.balance || 0) }}</p><p class="mt-2">本次{{ adjustDirection === 1 ? '增加' : '扣除' }}：{{ formatUsd(Math.abs(signedAmount)) }}</p><p class="mt-2 font-semibold">预计余额：{{ formatUsd(adjustedBalance) }}</p></div>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showAdjust = false">取消</UiButton>
          <UiButton type="primary" :loading="adjusting" @click="adjustWallet">{{ adjustDirection === 1 ? '确认充值' : '确认扣款' }}</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal v-model:show="showConcurrency" :title="`并发上限：${selectedUser?.name ?? ''}`" :width="460">
      <UiForm label-placement="top" @submit="saveConcurrency">
        <UiFormItem label="最大并发请求数（跨该用户所有 Key）">
          <UiInputNumber v-model:value="concurrencyForm.value" :min="1" :step="1" placeholder="留空 = 不限" style="width: 100%" />
        </UiFormItem>
      </UiForm>
      <div class="subline">同一时刻在途请求数超过该值时返回 429。留空或 0 表示不限制。</div>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showConcurrency = false">取消</UiButton>
          <UiButton type="primary" :loading="savingConcurrency" @click="saveConcurrency">保存</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal v-model:show="showWallet" :title="`钱包流水：${selectedUser?.name ?? ''}`" :width="760">
      <UiDataTable :columns="walletColumns" :data="walletRows" :loading="walletLoading" :bordered="false" :scroll-x="660" />
    </UiModal>

    <UiModal v-model:show="showUsage" :title="`用量：${selectedUser?.name ?? ''}`" :width="860">
      <UiDataTable :columns="usageColumns" :data="usageRows" :loading="usageLoading" :bordered="false" :scroll-x="780" />
    </UiModal>

    <UiModal v-model:show="showSubs" :title="`订阅：${selectedUser?.name ?? ''}`" :width="560">
      <div class="assign-row">
        <UiSelect v-model:value="assignPlanId" :options="subPlanOptions" placeholder="选择套餐分配" style="flex: 1" />
        <UiButton type="primary" :loading="assigning" @click="assignSubscription">分配</UiButton>
      </div>
      <UiSpin :show="subsLoading">
        <p v-if="!subsRows.length" class="subs-empty">该用户暂无订阅。</p>
        <div v-for="sub in subsRows" :key="sub.id" class="subs-row">
          <div>
            <strong>{{ sub.planName || '套餐' }}</strong>
            <span class="subtext">{{ sub.groupName || '' }} · 到期 {{ formatTime(sub.expiresAt) }}</span>
          </div>
          <UiTag size="small" :type="sub.status === 'active' ? 'success' : 'default'" :bordered="false">
            {{ sub.status === 'active' ? '生效中' : '已过期' }}
          </UiTag>
        </div>
      </UiSpin>
    </UiModal>
  </div>
</template>

<style scoped>
.assign-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.subs-empty {
  margin: 0;
  color: rgba(15, 23, 42, 0.5);
  font-size: 13px;
}

.subs-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}

.subs-row:last-child {
  border-bottom: none;
}

.subs-row .subtext {
  display: block;
  margin-top: 2px;
  color: rgba(15, 23, 42, 0.5);
  font-size: 12px;
}
</style>

<style scoped>
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

:deep(strong) {
  display: block;
  color: #0f172a;
  font-size: 14px;
}

.user-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

:deep(.subtext) {
  display: block;
  margin-top: 3px;
  color: rgba(15, 23, 42, 0.5);
  font-size: 12px;
}

:deep(.amount) {
  color: #16a34a;
  font-weight: 700;
}

:deep(.danger) {
  color: #dc2626;
  font-weight: 700;
}

.subline {
  margin-top: 10px;
  color: rgba(15, 23, 42, 0.58);
  font-size: 12px;
}
</style>
