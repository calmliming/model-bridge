<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface Account {
  id: string
  provider: string
  name: string
  status: string
  tokenExpiresAt: number | null
  cooldownUntil: number | null
  lastUsedAt: number | null
  createdAt: number
}

const message = useMessage()
const dialog = useDialog()

const accounts = ref<Account[]>([])
const loading = ref(true)

// Add-account modal state.
const showAdd = ref(false)
const step = ref<'name' | 'authorize'>('name')
const accountName = ref('')
const authorizeUrl = ref('')
const oauthState = ref('')
const pasteCode = ref('')
const busy = ref(false)

const statusMeta: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'default' }> = {
  active: { label: '正常', type: 'success' },
  rate_limited: { label: '限流冷却', type: 'warning' },
  error: { label: '异常', type: 'error' },
  disabled: { label: '已禁用', type: 'default' },
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/accounts')
    accounts.value = data.accounts
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

function openAdd() {
  step.value = 'name'
  accountName.value = ''
  authorizeUrl.value = ''
  oauthState.value = ''
  pasteCode.value = ''
  showAdd.value = true
}

async function startOAuth() {
  if (!accountName.value.trim()) {
    message.warning('请填写账户名称')
    return
  }
  busy.value = true
  try {
    const { data } = await api.post('/admin/accounts/oauth/start', { provider: 'claude' })
    oauthState.value = data.state
    authorizeUrl.value = data.authorizeUrl
    step.value = 'authorize'
  } catch (e) {
    message.error(errMsg(e, '生成授权链接失败'))
  } finally {
    busy.value = false
  }
}

async function finishOAuth() {
  if (!pasteCode.value.trim()) {
    message.warning('请粘贴授权码')
    return
  }
  busy.value = true
  try {
    await api.post('/admin/accounts/oauth/finish', {
      provider: 'claude',
      name: accountName.value.trim(),
      state: oauthState.value,
      code: pasteCode.value.trim(),
    })
    message.success('Claude 账户已添加')
    showAdd.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '授权失败'))
  } finally {
    busy.value = false
  }
}

function openAuthorizeUrl() {
  window.open(authorizeUrl.value, '_blank', 'noopener')
}

async function toggle(row: Account) {
  const next = row.status === 'disabled' ? 'active' : 'disabled'
  try {
    await api.patch(`/admin/accounts/${row.id}`, { status: next })
    await load()
  } catch (e) {
    message.error(errMsg(e))
  }
}

function confirmDelete(row: Account) {
  dialog.warning({
    title: '删除账户',
    content: `确定删除「${row.name}」？该订阅将不再参与中转。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.delete(`/admin/accounts/${row.id}`)
        message.success('已删除')
        await load()
      } catch (e) {
        message.error(errMsg(e))
      }
    },
  })
}

const columns = computed<DataTableColumns<Account>>(() => [
  { title: '名称', key: 'name', minWidth: 120 },
  {
    title: '服务商',
    key: 'provider',
    render: (row) => h(NTag, { size: 'small', bordered: false }, { default: () => row.provider }),
  },
  {
    title: '状态',
    key: 'status',
    render: (row) => {
      const meta = statusMeta[row.status] ?? { label: row.status, type: 'default' as const }
      return h(NTag, { size: 'small', type: meta.type, bordered: false }, { default: () => meta.label })
    },
  },
  { title: '令牌到期', key: 'tokenExpiresAt', render: (row) => formatTime(row.tokenExpiresAt) },
  { title: '最后使用', key: 'lastUsedAt', render: (row) => formatTime(row.lastUsedAt) },
  {
    title: '启用',
    key: 'toggle',
    render: (row) =>
      h(NSwitch, {
        value: row.status !== 'disabled',
        size: 'small',
        onUpdateValue: () => toggle(row),
      }),
  },
  {
    title: '操作',
    key: 'actions',
    render: (row) =>
      h(
        NButton,
        { size: 'small', type: 'error', quaternary: true, onClick: () => confirmDelete(row) },
        { default: () => '删除' },
      ),
  },
])

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h2 class="page-title">上游账户</h2>
      <n-button type="primary" @click="openAdd">+ 添加 Claude 账户</n-button>
    </div>

    <n-card>
      <n-data-table :columns="columns" :data="accounts" :loading="loading" :bordered="false" />
    </n-card>

    <n-modal v-model:show="showAdd" preset="card" title="添加 Claude 账户" style="width: 520px">
      <div v-if="step === 'name'">
        <n-form label-placement="top">
          <n-form-item label="账户名称">
            <n-input v-model:value="accountName" placeholder="例如：我的 Claude Max" />
          </n-form-item>
        </n-form>
        <n-text depth="3" style="font-size: 13px">
          下一步会生成 claude.ai 授权链接；你需要用拥有 Claude 订阅的账号登录并授权。
        </n-text>
      </div>

      <div v-else>
        <n-text strong>第 1 步</n-text>
        <n-text depth="3">　用拥有 Claude 订阅的账号打开下面的链接并完成授权：</n-text>
        <n-input
          :value="authorizeUrl"
          readonly
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          style="margin: 10px 0"
        />
        <n-button ghost type="primary" size="small" @click="openAuthorizeUrl">
          在浏览器中打开 ↗
        </n-button>
        <n-divider style="margin: 16px 0" />
        <n-text strong>第 2 步</n-text>
        <n-text depth="3">　授权后页面会显示一段 Authorization Code，复制并粘贴到这里：</n-text>
        <n-input
          v-model:value="pasteCode"
          placeholder="粘贴 Authorization Code"
          style="margin-top: 10px"
        />
      </div>

      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdd = false">取消</n-button>
          <n-button v-if="step === 'name'" type="primary" :loading="busy" @click="startOAuth">
            生成授权链接
          </n-button>
          <n-button v-else type="primary" :loading="busy" @click="finishOAuth">完成授权</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>
