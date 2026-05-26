<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface AccountQuotaWindow {
  key: 'hourly' | 'weekly' | 'weekly_sonnet' | 'primary' | 'secondary'
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
type TagType = 'success' | 'warning' | 'error' | 'default' | 'info'

const message = useMessage()
const dialog = useDialog()

const accounts = ref<Account[]>([])
const loading = ref(true)
const testingId = ref<string | null>(null)
const refreshingQuotaId = ref<string | null>(null)

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
const providerTagType: Record<Provider, TagType> = {
  claude: 'info',
  openai: 'success',
  gemini: 'warning',
}
const authorizeHost: Record<Provider, string> = {
  claude: 'claude.ai',
  openai: 'auth.openai.com',
  gemini: 'accounts.google.com',
}

const statusMeta: Record<string, { label: string; type: TagType }> = {
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

function formatPercent(value: number | null) {
  if (value == null) return '—'
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`
}

function formatShortTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDurationUntil(ms: number | null | undefined): string {
  if (!ms) return '—'
  const totalMinutes = Math.max(0, Math.ceil((ms - Date.now()) / 60_000))
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days}d ${restHours}h` : `${days}d`
}

function formatRelativePast(ms: number | null | undefined): string {
  if (!ms) return '—'
  const totalMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000))
  if (totalMinutes < 1) return '刚刚'
  if (totalMinutes < 60) return `${totalMinutes}m前`
  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) return `${hours}h前`
  return `${Math.floor(hours / 24)}d前`
}

function providerName(provider: string) {
  return providerLabel[provider as Provider] ?? provider
}

function providerType(provider: string): TagType {
  return providerTagType[provider as Provider] ?? 'default'
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

function quotaLabel(window: AccountQuotaWindow) {
  if (window.key === 'hourly' || window.key === 'secondary') return '5小时'
  if (window.key === 'weekly_sonnet') return '7天 Sonnet'
  if (window.key === 'weekly' || window.key === 'primary') return '7天'
  if (['主', '主额', '主额度', 'primary'].includes(window.label)) return '7天'
  if (['次', '次额', '次额度', 'secondary'].includes(window.label)) return '5小时'
  return window.label
}

function quotaWindowClass(window: AccountQuotaWindow) {
  const label = quotaLabel(window)
  return label.includes('7天') ? 'is-7d' : 'is-5h'
}

function renderAccount(row: Account) {
  return h('div', { class: 'account-name' }, row.name)
}

function renderStatus(row: Account) {
  const status = effectiveStatus(row)
  const meta = statusMeta[status] ?? { label: status, type: 'default' as const }
  return h(
    NSpace,
    { size: 6, vertical: true },
    {
      default: () => [
        h(NTag, { size: 'small', type: meta.type, bordered: false }, { default: () => meta.label }),
        isCoolingDown(row)
          ? h('span', { class: 'muted-cell' }, `至 ${formatShortTime(row.cooldownUntil)}`)
          : null,
      ],
    },
  )
}

function renderQuotaWindow(window: AccountQuotaWindow) {
  return h('div', { class: 'quota-row' }, [
    h('span', { class: ['quota-label', quotaWindowClass(window)] }, quotaLabel(window)),
    h('span', { class: 'quota-bar-track' }, [
      h('span', {
        class: ['quota-bar-fill', `is-${quotaStatus(window)}`],
        style: { width: `${quotaPercent(window)}%` },
      }),
    ]),
    h('span', { class: ['quota-percent', `is-${quotaStatus(window)}`] }, formatPercent(window.usedPercent)),
    h('span', { class: 'quota-reset' }, formatDurationUntil(window.resetAt)),
  ])
}

function renderQuotaRefresh(row: Account, updatedAt?: number | null) {
  return h(
    'div',
    { class: 'quota-refresh-wrap' },
    [
      updatedAt ? h('span', { class: 'quota-updated' }, formatRelativePast(updatedAt)) : null,
      h(
        NButton,
        {
          size: 'tiny',
          quaternary: true,
          circle: true,
          title: '刷新配额',
          'aria-label': '刷新配额',
          loading: refreshingQuotaId.value === row.id,
          class: 'quota-refresh',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            void refreshQuota(row)
          },
        },
        {
          icon: () => h('span', { class: 'quota-refresh-icon', 'aria-hidden': 'true' }, '↻'),
        },
      ),
    ],
  )
}

function renderQuota(row: Account) {
  const quota = row.quota
  if (!quota || !quota.windows.length) {
    return h('div', { class: 'quota-cell' }, [
      h('span', { class: 'muted-cell' }, '未更新'),
      renderQuotaRefresh(row),
    ])
  }
  return h(
    'div',
    { class: 'quota-cell' },
    [
      h('div', { class: 'quota-line' }, [
        ...quota.windows.map(renderQuotaWindow),
      ]),
      renderQuotaRefresh(row, quota.updatedAt),
    ],
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

async function refreshQuota(row: Account) {
  refreshingQuotaId.value = row.id
  try {
    const { data } = await api.post(`/admin/accounts/${row.id}/quota/refresh`)
    if (data.success) {
      message.success('配额已刷新')
      await load()
      return
    }
    message.error(data.message || '刷新配额失败')
  } catch (e) {
    message.error(errMsg(e, '刷新配额失败'))
  } finally {
    refreshingQuotaId.value = null
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
  { title: '账户', key: 'name', minWidth: 160, render: renderAccount },
  {
    title: '服务商',
    key: 'provider',
    width: 100,
    render: (row) =>
      h(
        NTag,
        { size: 'small', type: providerType(row.provider), bordered: false },
        { default: () => providerName(row.provider) },
      ),
  },
  {
    title: '状态',
    key: 'status',
    width: 110,
    render: renderStatus,
  },
  { title: '访问令牌刷新', key: 'tokenExpiresAt', minWidth: 150, render: (row) => formatTime(row.tokenExpiresAt) },
  { title: '配额', key: 'quota', minWidth: 330, render: renderQuota },
  { title: '最后使用', key: 'lastUsedAt', minWidth: 150, render: (row) => formatTime(row.lastUsedAt) },
  {
    title: '调度',
    key: 'toggle',
    width: 86,
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
    width: 130,
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
        :scroll-x="1240"
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
:deep(.muted-cell) {
  color: rgba(15, 23, 42, 0.52);
  font-size: 12px;
  line-height: 1.35;
}

:deep(.account-name) {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.quota-cell) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

:deep(.quota-line) {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

:deep(.quota-row) {
  display: grid;
  grid-template-columns: 42px 48px 44px minmax(54px, 1fr);
  align-items: center;
  gap: 6px;
  min-width: 0;
}

:deep(.quota-label) {
  padding: 1px 5px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
  text-align: center;
  white-space: nowrap;
}

:deep(.quota-label.is-5h) {
  color: #3730a3;
  background: #e0e7ff;
}

:deep(.quota-label.is-7d) {
  color: #047857;
  background: #d1fae5;
}

:deep(.quota-percent),
:deep(.quota-reset),
:deep(.quota-updated) {
  font-size: 11px;
  line-height: 1.35;
}

:deep(.quota-bar-track) {
  display: block;
  width: 48px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.1);
}

:deep(.quota-bar-fill) {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 0.2s ease;
}

:deep(.quota-bar-fill.is-success) {
  background: #18a058;
}

:deep(.quota-bar-fill.is-warning) {
  background: #f0a020;
}

:deep(.quota-bar-fill.is-error) {
  background: #d03050;
}

:deep(.quota-percent) {
  color: rgba(15, 23, 42, 0.68);
  font-weight: 650;
  text-align: right;
  white-space: nowrap;
}

:deep(.quota-percent.is-success) {
  color: #18a058;
}

:deep(.quota-percent.is-warning) {
  color: #f0a020;
}

:deep(.quota-percent.is-error) {
  color: #d03050;
}

:deep(.quota-reset),
:deep(.quota-updated) {
  color: rgba(15, 23, 42, 0.52);
  white-space: nowrap;
}

:deep(.quota-updated) {
  font-size: 10px;
}

:deep(.quota-refresh-wrap) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

:deep(.quota-refresh) {
  --n-width: 22px;
  --n-height: 22px;
  color: rgba(15, 23, 42, 0.52);
  font-size: 13px;
}

:deep(.quota-refresh:hover) {
  color: #2563eb;
}

:deep(.quota-refresh-icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
</style>
