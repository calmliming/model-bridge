<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NProgress, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface AccountQuotaWindow {
  key: 'hourly' | 'weekly' | 'primary' | 'secondary'
  label: string
  usedPercent: number | null
  resetAt: number | null
  exceeded: boolean
}

interface AccountQuotaSnapshot {
  source: 'claude' | 'openai'
  updatedAt: number
  windows: AccountQuotaWindow[]
}

interface Account {
  id: string
  provider: string
  name: string
  status: string
  tokenExpiresAt: number | null
  cooldownUntil: number | null
  lastUsedAt: number | null
  createdAt: number
  quota: AccountQuotaSnapshot | null
}

type Provider = 'claude' | 'openai' | 'gemini'

const message = useMessage()
const dialog = useDialog()

const accounts = ref<Account[]>([])
const loading = ref(true)
const testingId = ref<string | null>(null)

// Add-account modal state.
const showAdd = ref(false)
const step = ref<'name' | 'authorize'>('name')
const form = ref<{ provider: Provider; name: string }>({ provider: 'claude', name: '' })
const authorizeUrl = ref('')
const oauthState = ref('')
const oauthMode = ref<'paste' | 'callback'>('paste')
const pasteCode = ref('')
const pasteCallbackUrl = ref('')
const showImportToken = ref(false)
const importAccessToken = ref('')
const importRefreshToken = ref('')
const busy = ref(false)
let refreshTimer: number | null = null

const providerLabel: Record<Provider, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
}
const authorizeHost: Record<Provider, string> = {
  claude: 'claude.ai',
  openai: 'auth.openai.com',
  gemini: 'accounts.google.com',
}

const statusMeta: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'default' }> = {
  active: { label: '正常', type: 'success' },
  rate_limited: { label: '限流冷却', type: 'warning' },
  error: { label: '异常', type: 'error' },
  disabled: { label: '已禁用', type: 'default' },
}

function isCoolingDown(row: Account) {
  return !!row.cooldownUntil && row.cooldownUntil > Date.now()
}

function effectiveStatus(row: Account) {
  if (isCoolingDown(row)) return row.status === 'error' ? 'error' : 'rate_limited'
  return row.status
}

function formatQuotaRefresh(row: Account) {
  return isCoolingDown(row) ? formatTime(row.cooldownUntil) : '—'
}

function formatPercent(value: number | null) {
  if (value == null) return '—'
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`
}

function quotaStatus(window: AccountQuotaWindow) {
  if (window.exceeded) return 'error'
  const used = window.usedPercent ?? 0
  if (used >= 90) return 'error'
  if (used >= 70) return 'warning'
  return 'success'
}

function quotaPercent(window: AccountQuotaWindow) {
  return Math.max(0, Math.min(100, Math.round(window.usedPercent ?? 0)))
}

function renderQuota(row: Account) {
  const quota = row.quota
  if (!quota || !quota.windows.length) return h('span', { class: 'muted-cell' }, '待请求更新')
  const windows = quota.windows
  return h('div', { class: 'quota-stack' }, [
    ...windows.map((window) =>
      h('div', { class: 'quota-window' }, [
        h('span', { class: 'quota-label' }, window.label),
        h(NProgress, {
          type: 'line',
          percentage: quotaPercent(window),
          status: quotaStatus(window),
          showIndicator: false,
          height: 6,
          borderRadius: 3,
          class: 'quota-progress',
        }),
        h('span', { class: 'quota-percent' }, formatPercent(window.usedPercent)),
      ]),
    ),
    h('span', { class: 'quota-updated' }, `刷新 ${formatTime(quota.updatedAt)}`),
  ])
}

function renderQuotaReset(row: Account) {
  const windows = row.quota?.windows ?? []
  if (!windows.length) return formatQuotaRefresh(row)
  return h(
    'div',
    { class: 'quota-reset-stack' },
    windows.map((window) =>
      h('span', { class: window.exceeded ? 'quota-reset is-exceeded' : 'quota-reset' }, [
        h('strong', null, `${window.label} `),
        formatTime(window.resetAt),
      ]),
    ),
  )
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
  form.value = { provider: 'claude', name: '' }
  authorizeUrl.value = ''
  oauthState.value = ''
  oauthMode.value = 'paste'
  pasteCode.value = ''
  pasteCallbackUrl.value = ''
  showImportToken.value = false
  importAccessToken.value = ''
  importRefreshToken.value = ''
  showAdd.value = true
}

async function startOAuth() {
  if (!form.value.name.trim()) {
    message.warning('请填写账户名称')
    return
  }
  busy.value = true
  try {
    const { data } = await api.post('/admin/accounts/oauth/start', {
      provider: form.value.provider,
      name: form.value.name.trim(),
    })
    oauthState.value = data.state
    authorizeUrl.value = data.authorizeUrl
    oauthMode.value = data.mode ?? 'paste'
    step.value = 'authorize'
  } catch (e) {
    message.error(errMsg(e, '生成授权链接失败'))
  } finally {
    busy.value = false
  }
}

async function finishPaste() {
  if (!pasteCode.value.trim()) {
    message.warning('请粘贴授权码')
    return
  }
  busy.value = true
  try {
    await api.post('/admin/accounts/oauth/finish', {
      state: oauthState.value,
      code: pasteCode.value.trim(),
    })
    message.success(`${providerLabel[form.value.provider]} 账户已添加`)
    showAdd.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '授权失败'))
  } finally {
    busy.value = false
  }
}

async function finishCallback() {
  // Browser-redirect flow: the :1455 listener already created the account
  // upstream. We just refresh the list and confirm it appeared.
  busy.value = true
  try {
    await load()
    const created = accounts.value.some(
      (a) => a.provider === form.value.provider && a.name === form.value.name.trim(),
    )
    if (!created) {
      message.warning('暂未检测到新账户，请确认浏览器已完成授权后再试')
      return
    }
    message.success(`${providerLabel[form.value.provider]} 账户已添加`)
    showAdd.value = false
  } finally {
    busy.value = false
  }
}

async function finishPasteCallback() {
  if (!pasteCallbackUrl.value.trim()) {
    message.warning('请粘贴浏览器地址栏中的完整回调 URL')
    return
  }
  busy.value = true
  try {
    await api.post('/admin/accounts/oauth/finish', {
      callbackUrl: pasteCallbackUrl.value.trim(),
    })
    message.success(`${providerLabel[form.value.provider]} 账户已添加`)
    showAdd.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '授权失败'))
  } finally {
    busy.value = false
  }
}

async function finishImportToken() {
  if (!importAccessToken.value.trim()) {
    message.warning('请填写 Access Token')
    return
  }
  if (!form.value.name.trim()) {
    message.warning('请填写账户名称')
    return
  }
  busy.value = true
  try {
    const payload: Record<string, unknown> = {
      provider: form.value.provider,
      name: form.value.name.trim(),
      accessToken: importAccessToken.value.trim(),
    }
    if (importRefreshToken.value.trim()) {
      payload.refreshToken = importRefreshToken.value.trim()
    }
    await api.post('/admin/accounts/import/token', payload)
    message.success(`${providerLabel[form.value.provider]} 账户已添加`)
    showAdd.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '导入失败'))
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

async function testConnectivity(row: Account) {
  testingId.value = row.id
  try {
    const { data } = await api.post(`/admin/accounts/${row.id}/test`)
    if (data.success) {
      const suffix = data.latencyMs != null ? `（${data.latencyMs}ms）` : ''
      message.success(`${row.name} 连通正常${suffix}`)
      await load()
      return
    }
    message.error(data.message || '连通性测试失败')
  } catch (e) {
    message.error(errMsg(e, '连通性测试失败'))
  } finally {
    testingId.value = null
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
      const status = effectiveStatus(row)
      const meta = statusMeta[status] ?? { label: status, type: 'default' as const }
      return h(NTag, { size: 'small', type: meta.type, bordered: false }, { default: () => meta.label })
    },
  },
  { title: '令牌到期', key: 'tokenExpiresAt', render: (row) => formatTime(row.tokenExpiresAt) },
  { title: '实时配额', key: 'quota', minWidth: 190, render: renderQuota },
  { title: '配额更新', key: 'quotaReset', minWidth: 190, render: renderQuotaReset },
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
        NSpace,
        { size: 4 },
        {
          default: () => [
            h(
              NButton,
              {
                size: 'small',
                quaternary: true,
                loading: testingId.value === row.id,
                onClick: () => testConnectivity(row),
              },
              { default: () => '测试' },
            ),
            h(
              NButton,
              { size: 'small', type: 'error', quaternary: true, onClick: () => confirmDelete(row) },
              { default: () => '删除' },
            ),
          ],
        },
      ),
  },
])

onMounted(() => {
  void load()
  refreshTimer = window.setInterval(() => void load(), 30_000)
})

onBeforeUnmount(() => {
  if (refreshTimer != null) window.clearInterval(refreshTimer)
})
</script>

<template>
  <div>
    <div class="page-head">
      <n-button type="primary" @click="openAdd">添加账户</n-button>
    </div>

    <n-card class="table-card" :bordered="false">
      <n-data-table
        :columns="columns"
        :data="accounts"
        :loading="loading"
        :bordered="false"
        :scroll-x="1180"
      />
    </n-card>

    <n-modal v-model:show="showAdd" preset="card" title="添加上游账户" style="width: 520px">
      <div v-if="step === 'name'">
        <n-form label-placement="top">
          <n-form-item label="服务商">
            <n-radio-group v-model:value="form.provider">
              <n-radio-button value="claude">Claude</n-radio-button>
              <n-radio-button value="openai">OpenAI</n-radio-button>
              <n-radio-button value="gemini">Gemini</n-radio-button>
            </n-radio-group>
          </n-form-item>
          <n-form-item label="账户名称">
            <n-input
              v-model:value="form.name"
              :placeholder="`例如：我的 ${providerLabel[form.provider]}`"
            />
          </n-form-item>
        </n-form>
        <n-text depth="3" style="font-size: 13px">
          下一步会生成 {{ authorizeHost[form.provider] }} 的授权链接；
          你需要用拥有该订阅的账号登录并授权。
        </n-text>
      </div>

      <div v-else>
        <n-text strong>第 1 步</n-text>
        <n-text depth="3">　用拥有 {{ providerLabel[form.provider] }} 订阅的账号打开下面的链接并完成授权：</n-text>
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
        <template v-if="oauthMode === 'paste'">
          <n-text depth="3">　授权后页面会显示一段 Authorization Code，复制并粘贴到这里：</n-text>
          <n-input
            v-model:value="pasteCode"
            placeholder="粘贴 Authorization Code"
            style="margin-top: 10px"
          />
        </template>
        <template v-else>
          <n-text depth="3">
            　完成授权后，浏览器会自动跳转。如果本机能访问服务器的 1455 端口（如本地部署），授权会自动完成。
          </n-text>
          <n-text depth="3" style="display: block; margin-top: 6px; font-size: 12px">
            （回调由本机 1455 端口处理；浏览器必须能访问运行 model-bridge 那台机器的 localhost:1455）
          </n-text>
          <n-divider style="margin: 18px 0">远程部署 / 手动完成</n-divider>

          <n-text depth="3" style="font-size: 13px">
            如果服务器不在本地，浏览器跳转到 localhost 后页面会打不开。<strong>复制浏览器地址栏中的完整 URL</strong>，粘贴到下面：
          </n-text>
          <n-input
            v-model:value="pasteCallbackUrl"
            placeholder="http://localhost:1455/auth/callback?code=...&state=..."
            style="margin-top: 8px"
          />
          <n-text depth="3" style="display: block; margin-top: 4px; font-size: 12px">
            支持粘贴完整 URL，系统会自动提取 code 和 state
          </n-text>
          <n-button
            type="primary"
            size="small"
            :loading="busy"
            :disabled="!pasteCallbackUrl.trim()"
            style="margin-top: 10px; width: 100%"
            @click="finishPasteCallback"
          >
            粘贴 URL 完成授权
          </n-button>

          <n-divider style="margin: 18px 0">直接导入 Token</n-divider>

          <n-button
            size="small"
            quaternary
            @click="showImportToken = !showImportToken"
            style="margin-bottom: 8px"
          >
            {{ showImportToken ? '收起' : '展开' }} Token 手动导入
          </n-button>
          <template v-if="showImportToken">
            <n-text depth="3" style="font-size: 12px">
              适合已有 Access Token / Refresh Token 的场景，跳过 OAuth 授权流程。
            </n-text>
            <n-input
              v-model:value="importAccessToken"
              placeholder="Access Token（必填）"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              style="margin-top: 8px"
            />
            <n-input
              v-model:value="importRefreshToken"
              placeholder="Refresh Token（可选）"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 3 }"
              style="margin-top: 8px"
            />
            <n-button
              type="primary"
              size="small"
              :loading="busy"
              :disabled="!importAccessToken.trim()"
              style="margin-top: 10px; width: 100%"
              @click="finishImportToken"
            >
              导入 Token
            </n-button>
          </template>
        </template>
      </div>

      <template #footer>
        <n-space justify="end">
          <n-button @click="showAdd = false">取消</n-button>
          <n-button v-if="step === 'name'" type="primary" :loading="busy" @click="startOAuth">
            生成授权链接
          </n-button>
          <n-button
            v-else-if="oauthMode === 'paste'"
            type="primary"
            :loading="busy"
            @click="finishPaste"
          >
            完成授权
          </n-button>
          <n-button v-else type="primary" :loading="busy" @click="finishCallback">
            我已完成授权
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.muted-cell {
  color: rgba(15, 23, 42, 0.52);
}

.quota-stack,
.quota-reset-stack {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.quota-window {
  display: grid;
  grid-template-columns: 42px minmax(72px, 1fr) 42px;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.quota-label,
.quota-percent,
.quota-updated,
.quota-reset {
  font-size: 12px;
  line-height: 1.35;
}

.quota-label,
.quota-percent {
  color: #0f172a;
}

.quota-progress {
  min-width: 72px;
}

.quota-updated,
.quota-reset {
  color: rgba(15, 23, 42, 0.52);
}

.quota-reset strong {
  color: #0f172a;
  font-weight: 500;
}

.quota-reset.is-exceeded,
.quota-reset.is-exceeded strong {
  color: #d03050;
}
</style>
