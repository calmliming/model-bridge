<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NSpace, NTag, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface UserRow {
  id: string
  email: string
  name: string
  status: 'active' | 'disabled'
  balance: number
  acceptedAt: number | null
  lastLoginAt: number | null
  createdAt: number
  keyCount: number
  requestCount: number
  totalCost: number
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
const showInvite = ref(false)
const inviting = ref(false)
const inviteForm = ref({ email: '', name: '' })
const inviteResult = ref<{ token: string; inviteUrl: string; expiresAt: number } | null>(null)

const showAdjust = ref(false)
const adjusting = ref(false)
const selectedUser = ref<UserRow | null>(null)
const adjustForm = ref({ amount: 10, note: '' })

const showWallet = ref(false)
const walletLoading = ref(false)
const walletRows = ref<WalletTransaction[]>([])

const showUsage = ref(false)
const usageLoading = ref(false)
const usageRows = ref<UsageLog[]>([])

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

function formatTokens(row: UsageLog): string {
  return (row.inputTokens + row.outputTokens + row.cacheCreateTokens + row.cacheReadTokens).toLocaleString('en-US')
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
      name: inviteForm.value.name.trim() || undefined,
    })
    inviteResult.value = {
      token: data.token,
      inviteUrl: data.inviteUrl,
      expiresAt: data.expiresAt,
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

async function updateStatus(row: UserRow) {
  try {
    await api.patch(`/admin/users/${row.id}`, {
      status: row.status === 'active' ? 'disabled' : 'active',
    })
    await load()
  } catch (e) {
    message.error(errMsg(e))
  }
}

function openAdjust(row: UserRow, sign: 1 | -1) {
  selectedUser.value = row
  adjustForm.value = { amount: sign * 10, note: '' }
  showAdjust.value = true
}

async function adjustWallet() {
  if (!selectedUser.value) return
  adjusting.value = true
  try {
    await api.post(`/admin/users/${selectedUser.value.id}/wallet`, {
      amount: adjustForm.value.amount,
      note: adjustForm.value.note.trim() || undefined,
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
    const { data } = await api.get(`/admin/users/${row.id}/wallet`, { params: { pageSize: 50 } })
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
    const { data } = await api.get(`/admin/users/${row.id}/usage`, { params: { pageSize: 50 } })
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
    return h(NTag, { size: 'small', bordered: false, type: 'warning' }, { default: () => '待接受' })
  }
  return h(
    NTag,
    { size: 'small', bordered: false, type: row.status === 'active' ? 'success' : 'error' },
    { default: () => (row.status === 'active' ? '启用' : '禁用') },
  )
}

const columns = computed<DataTableColumns<UserRow>>(() => [
  { title: '用户', key: 'user', minWidth: 210, render: (row) => h('div', [h('strong', row.name), h('span', { class: 'subtext' }, row.email)]) },
  { title: '余额', key: 'balance', minWidth: 96, render: (row) => h('span', { class: row.balance <= 0 ? 'danger' : 'amount' }, formatUsd(row.balance)) },
  { title: 'Keys', key: 'keyCount', width: 72 },
  { title: '请求', key: 'requestCount', width: 80, render: (row) => row.requestCount.toLocaleString('en-US') },
  { title: '成本', key: 'totalCost', width: 96, render: (row) => formatUsd(row.totalCost) },
  { title: '状态', key: 'status', width: 92, render: renderStatus },
  { title: '最后登录', key: 'lastLoginAt', minWidth: 140, render: (row) => formatTime(row.lastLoginAt) },
  { title: '创建', key: 'createdAt', minWidth: 140, render: (row) => formatTime(row.createdAt) },
  {
    title: '操作',
    key: 'actions',
    width: 270,
    render: (row) => h(NSpace, { size: 4, wrap: false }, {
      default: () => [
        h(NButton, { size: 'small', quaternary: true, onClick: () => openAdjust(row, 1) }, { default: () => '充值' }),
        h(NButton, { size: 'small', quaternary: true, onClick: () => openAdjust(row, -1) }, { default: () => '扣款' }),
        h(NButton, { size: 'small', quaternary: true, onClick: () => openWallet(row) }, { default: () => '流水' }),
        h(NButton, { size: 'small', quaternary: true, onClick: () => openUsage(row) }, { default: () => '用量' }),
        h(NButton, { size: 'small', type: row.status === 'active' ? 'error' : 'success', quaternary: true, onClick: () => updateStatus(row) }, { default: () => (row.status === 'active' ? '禁用' : '启用') }),
      ],
    }),
  },
])

const walletColumns: DataTableColumns<WalletTransaction> = [
  { title: '时间', key: 'createdAt', minWidth: 150, render: (row) => formatTime(row.createdAt) },
  { title: '类型', key: 'type', width: 90 },
  { title: '金额', key: 'amount', width: 110, render: (row) => h('span', { class: row.amount < 0 ? 'danger' : 'amount' }, formatUsd(row.amount)) },
  { title: '余额', key: 'balanceAfter', width: 110, render: (row) => formatUsd(row.balanceAfter) },
  { title: '备注', key: 'note', minWidth: 180, render: (row) => row.note || '—' },
]

const usageColumns: DataTableColumns<UsageLog> = [
  { title: '时间', key: 'ts', minWidth: 150, render: (row) => formatTime(row.ts) },
  { title: 'Key', key: 'apiKeyName', minWidth: 120, render: (row) => row.apiKeyName || '—' },
  { title: '服务商', key: 'provider', width: 90 },
  { title: '模型', key: 'model', minWidth: 160, render: (row) => row.model || '—' },
  { title: 'Tokens', key: 'tokens', width: 100, render: formatTokens },
  { title: '成本', key: 'cost', width: 100, render: (row) => formatUsd(row.cost) },
  { title: '状态', key: 'status', width: 90 },
]

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <n-button type="primary" @click="showInvite = true">邀请用户</n-button>
    </div>

    <n-card class="table-card" :bordered="false">
      <n-data-table :columns="columns" :data="users" :loading="loading" :bordered="false" :scroll-x="1260" />
    </n-card>

    <n-modal v-model:show="showInvite" preset="card" title="邀请用户" style="width: 460px">
      <n-form label-placement="top">
        <n-form-item label="邮箱">
          <n-input v-model:value="inviteForm.email" placeholder="user@example.com" />
        </n-form-item>
        <n-form-item label="名称">
          <n-input v-model:value="inviteForm.name" placeholder="可留空" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showInvite = false">取消</n-button>
          <n-button type="primary" :loading="inviting" @click="invite">生成邀请</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal :show="!!inviteResult" preset="card" title="邀请链接" style="width: 560px" @update:show="(shown: boolean) => { if (!shown) inviteResult = null }">
      <n-alert type="warning" style="margin-bottom: 12px">链接只在这里显示一次。</n-alert>
      <n-input :value="inviteResult?.inviteUrl ?? ''" readonly />
      <div class="subline">过期时间：{{ formatTime(inviteResult?.expiresAt) }}</div>
      <template #footer>
        <n-space justify="end">
          <n-button type="primary" @click="copyInvite">复制链接</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showAdjust" preset="card" :title="`调整余额：${selectedUser?.name ?? ''}`" style="width: 460px">
      <n-form label-placement="top">
        <n-form-item label="金额（USD，可为负数）">
          <n-input-number v-model:value="adjustForm.amount" :step="1" style="width: 100%" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="adjustForm.note" placeholder="可留空" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdjust = false">取消</n-button>
          <n-button type="primary" :loading="adjusting" @click="adjustWallet">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showWallet" preset="card" :title="`钱包流水：${selectedUser?.name ?? ''}`" style="width: 760px">
      <n-data-table :columns="walletColumns" :data="walletRows" :loading="walletLoading" :bordered="false" />
    </n-modal>

    <n-modal v-model:show="showUsage" preset="card" :title="`用量：${selectedUser?.name ?? ''}`" style="width: 860px">
      <n-data-table :columns="usageColumns" :data="usageRows" :loading="usageLoading" :bordered="false" :scroll-x="780" />
    </n-modal>
  </div>
</template>

<style scoped>
:deep(strong) {
  display: block;
  color: #0f172a;
  font-size: 14px;
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
