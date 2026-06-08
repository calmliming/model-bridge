<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { UiButton, UiInputNumber, UiSelect, UiSpace, UiSwitch, UiTag, UiTooltip } from '../components/ui'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
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

interface AccountGroupRef {
  id: string
  name: string
  weight: number | null
}

interface Account {
  id: string
  provider: string
  name: string
  status: string
  tokenExpiresAt: number | null
  cooldownUntil: number | null
  weight: number
  lastUsedAt: number | null
  groups: AccountGroupRef[]
  createdAt: number
  quota: AccountQuotaSnapshot | null
  // null = inherit global; 0 = auto-pause disabled; 1-100 = own threshold
  autopausePercent: number | null
}

/** A named account pool (distinct from the per-provider display grouping below). */
interface GroupInfo {
  id: string
  name: string
  description: string | null
  rateMultiplier: number
  accountCount: number
  createdAt: number
}

type Provider = 'claude' | 'openai' | 'gemini' | 'deepseek'
type TagType = 'success' | 'warning' | 'error' | 'default' | 'info'

interface AccountGroup {
  provider: string
  accounts: Account[]
  activeCount: number
  coolingCount: number
  disabledCount: number
}

const message = useMessage()
const dialog = useDialog()

const accounts = ref<Account[]>([])
const loading = ref(true)
const testingId = ref<string | null>(null)
const refreshingQuotaId = ref<string | null>(null)
const savingWeightId = ref<string | null>(null)
const savingAutopauseId = ref<string | null>(null)
const globalAutopausePercent = ref(100)

// Account-pool grouping (feature), distinct from the per-provider display group.
const groups = ref<GroupInfo[]>([])
const groupSelectOptions = computed(() =>
  groups.value.map((g) => ({
    label: g.rateMultiplier === 1 ? g.name : `${g.name} ×${g.rateMultiplier}`,
    value: g.id,
  })),
)
const showGroups = ref(false)
const groupViewMode = ref<'list' | 'create' | 'edit'>('list')
const editingGroup = ref<GroupInfo | null>(null)
const groupForm = ref<{ name: string; description: string; rateMultiplier: number | null }>({
  name: '',
  description: '',
  rateMultiplier: 1,
})
const savingGroup = ref(false)
const loadingGroups = ref(false)
const isGroupEditor = computed(() => groupViewMode.value !== 'list')
const groupModalTitle = computed(() => {
  if (groupViewMode.value === 'create') return '新建账号分组'
  if (groupViewMode.value === 'edit') return '编辑账号分组'
  return '管理账号分组'
})
const groupModalWidth = computed(() => (isGroupEditor.value ? 520 : 760))
const groupedAccountTotal = computed(() => groups.value.reduce((sum, group) => sum + group.accountCount, 0))
const groupSubmitLabel = computed(() => (groupViewMode.value === 'edit' ? '保存' : '创建'))

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
const deepseekApiKey = ref('')
const busy = ref(false)
let refreshTimer: number | null = null

const providerLabel: Record<Provider, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
}
const providerOrder: Provider[] = ['claude', 'openai', 'gemini', 'deepseek']
const providerTagType: Record<Provider, TagType> = {
  claude: 'error',
  openai: 'success',
  gemini: 'warning',
  deepseek: 'info',
}
const authorizeHost: Record<Provider, string> = {
  claude: 'claude.ai',
  openai: 'auth.openai.com',
  gemini: 'accounts.google.com',
  deepseek: 'platform.deepseek.com',
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
  if (row.status === 'disabled') return 'disabled'
  if (isCoolingDown(row)) return row.status === 'error' ? 'error' : 'rate_limited'
  if (row.status === 'error' || row.status === 'rate_limited') return 'active'
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

function formatRateMultiplier(value: number | null | undefined) {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? value : 1
  return `${normalized.toFixed(4).replace(/\.?0+$/, '')}x`
}

function rateMultiplierType(value: number | null | undefined): TagType {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? value : 1
  if (normalized < 1) return 'success'
  if (normalized > 1) return 'warning'
  return 'default'
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
  const tag = h(UiTag, { size: 'small', type: meta.type, bordered: false }, { default: () => meta.label })
  const cooldownText = `限流至 ${formatShortTime(row.cooldownUntil)}`

  if (status === 'rate_limited' && isCoolingDown(row)) {
    return h('div', { class: 'status-cell' }, [
      tag,
      h(
        UiTooltip,
        { placement: 'top', trigger: 'hover' },
        {
          trigger: () =>
            h(
              'span',
              {
                class: 'cooldown-hint-icon',
                tabindex: 0,
                title: cooldownText,
                'aria-label': cooldownText,
              },
              '?',
            ),
          default: () => cooldownText,
        },
      ),
    ])
  }

  return h(
    UiSpace,
    { size: 6, vertical: true },
    {
      default: () => [
        tag,
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
        UiButton,
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

function renderPriority(row: Account) {
  return h(UiInputNumber, {
    value: row.weight,
    min: 1,
    max: 100,
    precision: 0,
    size: 'small',
    showButton: true,
    disabled: savingWeightId.value === row.id,
    class: 'priority-input',
    'aria-label': `${row.name} 优先级`,
    onUpdateValue: (value: number | null) => {
      void updateWeight(row, value)
    },
  })
}

function renderAutopause(row: Account) {
  return h(UiInputNumber, {
    value: row.autopausePercent,
    min: 0,
    max: 100,
    step: 5,
    disabled: savingAutopauseId.value === row.id,
    placeholder: `继承 ${globalAutopausePercent.value}`,
    class: 'autopause-input',
    title: '用量达到该百分比时自动暂停调度，直到窗口重置。留空=继承全局，0=关闭。',
    'aria-label': `${row.name} 自动停调阈值`,
    onUpdateValue: (value: number | null) => {
      void updateAutopause(row, value)
    },
  })
}

function renderGroupCell(row: Account) {
  return h(UiSelect, {
    value: row.groups.map((g) => g.id),
    options: groupSelectOptions.value,
    multiple: true,
    clearable: true,
    size: 'small',
    placeholder: '默认池',
    maxTagCount: 'responsive',
    consistentMenuWidth: false,
    class: 'group-select',
    'aria-label': `${row.name} 分组`,
    onUpdateValue: (value: string | number | (string | number)[] | null) => {
      const groupIds = Array.isArray(value) ? value.map(String) : []
      void setGroups(row, groupIds)
    },
  })
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

async function loadGroups() {
  loadingGroups.value = true
  try {
    const { data } = await api.get('/admin/account-groups')
    groups.value = data.groups
  } catch (e) {
    message.error(errMsg(e, '加载分组失败'))
  } finally {
    loadingGroups.value = false
  }
}

async function setGroups(row: Account, groupIds: string[]) {
  const previous = row.groups
  row.groups = groupIds.map(
    (id) => previous.find((g) => g.id === id) ?? { id, name: groups.value.find((g) => g.id === id)?.name ?? id, weight: null },
  )
  try {
    await api.patch(`/admin/accounts/${row.id}`, { groupIds })
    await load()
    await loadGroups()
  } catch (e) {
    row.groups = previous
    message.error(errMsg(e, '更新分组失败'))
  }
}

function resetGroupEditor() {
  groupViewMode.value = 'list'
  editingGroup.value = null
  groupForm.value = { name: '', description: '', rateMultiplier: 1 }
}

function openGroups() {
  resetGroupEditor()
  showGroups.value = true
  void loadGroups()
}

function openCreateGroup() {
  groupViewMode.value = 'create'
  editingGroup.value = null
  groupForm.value = { name: '', description: '', rateMultiplier: 1 }
}

function openEditGroup(group: GroupInfo) {
  groupViewMode.value = 'edit'
  editingGroup.value = group
  groupForm.value = {
    name: group.name,
    description: group.description ?? '',
    rateMultiplier: group.rateMultiplier,
  }
}

function closeGroupEditor() {
  resetGroupEditor()
}

async function submitGroupForm() {
  if (!groupForm.value.name.trim()) {
    message.warning('请填写分组名称')
    return
  }
  const multiplier = groupForm.value.rateMultiplier
  if (multiplier == null || !Number.isFinite(multiplier) || multiplier <= 0) {
    message.warning('请填写有效倍率')
    return
  }

  savingGroup.value = true
  try {
    const payload = {
      name: groupForm.value.name.trim(),
      description: groupForm.value.description.trim(),
      rateMultiplier: multiplier,
    }
    if (groupViewMode.value === 'edit' && editingGroup.value) {
      await api.patch(`/admin/account-groups/${editingGroup.value.id}`, {
        ...payload,
        description: payload.description || null,
      })
      message.success('分组已更新')
    } else {
      await api.post('/admin/account-groups', {
        ...payload,
        description: payload.description || undefined,
      })
      message.success('分组已创建')
    }
    resetGroupEditor()
    await loadGroups()
  } catch (e) {
    message.error(errMsg(e, groupViewMode.value === 'edit' ? '保存分组失败' : '创建分组失败'))
  } finally {
    savingGroup.value = false
  }
}

function confirmDeleteGroup(group: GroupInfo) {
  dialog.warning({
    title: '删除分组',
    content: `确定删除分组「${group.name}」？组内账号与绑定该组的 Key 都会移回默认池。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.delete(`/admin/account-groups/${group.id}`)
        message.success('已删除')
        await loadGroups()
        await load()
      } catch (e) {
        message.error(errMsg(e))
      }
    },
  })
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
  deepseekApiKey.value = ''
  showAdd.value = true
}

async function finishDeepseekImport() {
  if (!form.value.name.trim()) {
    message.warning('请填写账户名称')
    return
  }
  if (!deepseekApiKey.value.trim()) {
    message.warning('请填写 DeepSeek API Key')
    return
  }
  busy.value = true
  try {
    await api.post('/admin/accounts/import/token', {
      provider: 'deepseek',
      name: form.value.name.trim(),
      accessToken: deepseekApiKey.value.trim(),
    })
    message.success('DeepSeek 账户已添加')
    showAdd.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '添加失败'))
  } finally {
    busy.value = false
  }
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

async function updateWeight(row: Account, value: number | null) {
  if (value == null) return
  const next = Math.max(1, Math.min(100, Math.trunc(value)))
  if (!Number.isFinite(next) || next === row.weight) return

  const previous = row.weight
  row.weight = next
  savingWeightId.value = row.id
  try {
    await api.patch(`/admin/accounts/${row.id}`, { weight: next })
  } catch (e) {
    row.weight = previous
    message.error(errMsg(e, '更新优先级失败'))
  } finally {
    if (savingWeightId.value === row.id) savingWeightId.value = null
  }
}

async function updateAutopause(row: Account, value: number | null) {
  // null = clear override (inherit global); 0-100 = explicit per-account threshold.
  const next = value == null ? null : Math.max(0, Math.min(100, Math.trunc(value)))
  if (next === row.autopausePercent) return

  const previous = row.autopausePercent
  row.autopausePercent = next
  savingAutopauseId.value = row.id
  try {
    await api.patch(`/admin/accounts/${row.id}`, { autopausePercent: next })
  } catch (e) {
    row.autopausePercent = previous
    message.error(errMsg(e, '更新停调阈值失败'))
  } finally {
    if (savingAutopauseId.value === row.id) savingAutopauseId.value = null
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

const columns = computed<TableColumn<Account>[]>(() => [
  { title: '账户', key: 'name', minWidth: 160, render: renderAccount },
  { title: '分组', key: 'group', width: 140, render: renderGroupCell },
  {
    title: '状态',
    key: 'status',
    width: 110,
    render: renderStatus,
  },
  { title: '访问令牌刷新', key: 'tokenExpiresAt', minWidth: 150, render: (row) => formatTime(row.tokenExpiresAt) },
  { title: '配额', key: 'quota', minWidth: 330, render: renderQuota },
  { title: '停调阈值', key: 'autopause', width: 116, render: renderAutopause },
  { title: '优先级', key: 'weight', width: 110, render: renderPriority },
  { title: '最后使用', key: 'lastUsedAt', minWidth: 150, render: (row) => formatTime(row.lastUsedAt) },
  {
    title: '调度',
    key: 'toggle',
    width: 86,
    render: (row) =>
      h(UiSwitch, {
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
        UiSpace,
        { size: 4 },
        {
          default: () => [
            h(
              UiButton,
              {
                size: 'small',
                quaternary: true,
                loading: testingId.value === row.id,
                onClick: () => testConnectivity(row),
              },
              { default: () => '测试' },
            ),
            h(
              UiButton,
              { size: 'small', type: 'error', quaternary: true, onClick: () => confirmDelete(row) },
              { default: () => '删除' },
            ),
          ],
        },
      ),
  },
])

const accountGroups = computed<AccountGroup[]>(() => {
  const groups = new Map<string, Account[]>()
  for (const account of accounts.value) {
    const rows = groups.get(account.provider) ?? []
    rows.push(account)
    groups.set(account.provider, rows)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => providerRank(a) - providerRank(b) || providerName(a).localeCompare(providerName(b)))
    .map(([provider, rows]) => ({
      provider,
      accounts: rows,
      activeCount: rows.filter((row) => effectiveStatus(row) === 'active').length,
      coolingCount: rows.filter((row) => isCoolingDown(row)).length,
      disabledCount: rows.filter((row) => row.status === 'disabled').length,
    }))
})

function providerRank(provider: string): number {
  const index = providerOrder.indexOf(provider as Provider)
  return index === -1 ? providerOrder.length : index
}

async function loadGlobalAutopause() {
  try {
    const { data } = await api.get('/admin/settings')
    if (typeof data.quotaAutopausePercent === 'number') {
      globalAutopausePercent.value = data.quotaAutopausePercent
    }
  } catch {
    // Non-critical: the column placeholder just falls back to the default.
  }
}

onMounted(() => {
  void load()
  void loadGroups()
  void loadGlobalAutopause()
  refreshTimer = window.setInterval(() => void load(), 30_000)
})

watch(showGroups, (open) => {
  if (!open) resetGroupEditor()
})

onBeforeUnmount(() => {
  if (refreshTimer != null) window.clearInterval(refreshTimer)
})
</script>

<template>
  <div>
    <div class="page-head">
      <UiButton secondary @click="openGroups">管理分组</UiButton>
      <UiButton type="primary" @click="openAdd">添加账户</UiButton>
    </div>

    <div v-if="accountGroups.length" class="account-groups">
      <UiCard
        v-for="group in accountGroups"
        :key="group.provider"
        class="table-card account-group-card"
        :bordered="false"
      >
        <div class="account-group-head">
          <div class="account-group-title">
            <UiTag size="small" :type="providerType(group.provider)" :bordered="false">
              {{ providerName(group.provider) }}
            </UiTag>
            <strong>{{ group.accounts.length }} 个账户</strong>
          </div>
          <div class="account-group-meta">
            <span>正常 {{ group.activeCount }}</span>
            <span>冷却 {{ group.coolingCount }}</span>
            <span>禁用 {{ group.disabledCount }}</span>
          </div>
        </div>
        <UiDataTable
          :columns="columns"
          :data="group.accounts"
          :loading="loading"
          :bordered="false"
          :scroll-x="1486"
        />
      </UiCard>
    </div>

    <UiCard v-else class="table-card" :bordered="false">
      <UiDataTable
        :columns="columns"
        :data="accounts"
        :loading="loading"
        :bordered="false"
        :scroll-x="1626"
      />
    </UiCard>

    <UiModal v-model:show="showAdd" title="添加上游账户" :width="520">
      <div v-if="step === 'name'">
        <UiForm label-placement="top">
          <UiFormItem label="服务商">
            <UiRadioGroup v-model:value="form.provider">
              <UiRadioButton value="claude">Claude</UiRadioButton>
              <UiRadioButton value="openai">OpenAI</UiRadioButton>
              <UiRadioButton value="gemini">Gemini</UiRadioButton>
              <UiRadioButton value="deepseek">DeepSeek</UiRadioButton>
            </UiRadioGroup>
          </UiFormItem>
          <UiFormItem label="账户名称">
            <UiInput
              v-model:value="form.name"
              :placeholder="`例如：我的 ${providerLabel[form.provider]}`"
            />
          </UiFormItem>
          <UiFormItem v-if="form.provider === 'deepseek'" label="API Key">
            <UiInput
              v-model:value="deepseekApiKey"
              placeholder="sk-..."
              type="password"
              show-password-on="click"
            />
          </UiFormItem>
        </UiForm>
        <UiText v-if="form.provider !== 'deepseek'" depth="3" style="font-size: 13px">
          下一步会生成 {{ authorizeHost[form.provider] }} 的授权链接；
          你需要用拥有该订阅的账号登录并授权。
        </UiText>
        <UiText v-else depth="3" style="font-size: 13px">
          在 platform.deepseek.com/api_keys 创建 API Key 后粘贴到上方。
        </UiText>
      </div>

      <div v-else>
        <UiText strong>第 1 步</UiText>
        <UiText depth="3">　用拥有 {{ providerLabel[form.provider] }} 订阅的账号打开下面的链接并完成授权：</UiText>
        <UiInput
          :value="authorizeUrl"
          readonly
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          style="margin: 10px 0"
        />
        <UiButton ghost type="primary" size="small" @click="openAuthorizeUrl">
          在浏览器中打开 ↗
        </UiButton>
        <UiDivider style="margin: 16px 0" />
        <UiText strong>第 2 步</UiText>
        <template v-if="oauthMode === 'paste'">
          <UiText depth="3">　授权后页面会显示一段 Authorization Code，复制并粘贴到这里：</UiText>
          <UiInput
            v-model:value="pasteCode"
            placeholder="粘贴 Authorization Code"
            style="margin-top: 10px"
          />
        </template>
        <template v-else>
          <UiText depth="3">
            　完成授权后，浏览器会自动跳转。如果本机能访问服务器的 1455 端口（如本地部署），授权会自动完成。
          </UiText>
          <UiText depth="3" style="display: block; margin-top: 6px; font-size: 12px">
            （回调由本机 1455 端口处理；浏览器必须能访问运行 model-bridge 那台机器的 localhost:1455）
          </UiText>
          <UiDivider style="margin: 18px 0">远程部署 / 手动完成</UiDivider>

          <UiText depth="3" style="font-size: 13px">
            如果服务器不在本地，浏览器跳转到 localhost 后页面会打不开。<strong>复制浏览器地址栏中的完整 URL</strong>，粘贴到下面：
          </UiText>
          <UiInput
            v-model:value="pasteCallbackUrl"
            placeholder="http://localhost:1455/auth/callback?code=...&state=..."
            style="margin-top: 8px"
          />
          <UiText depth="3" style="display: block; margin-top: 4px; font-size: 12px">
            支持粘贴完整 URL，系统会自动提取 code 和 state
          </UiText>
          <UiButton
            type="primary"
            size="small"
            :loading="busy"
            :disabled="!pasteCallbackUrl.trim()"
            style="margin-top: 10px; width: 100%"
            @click="finishPasteCallback"
          >
            粘贴 URL 完成授权
          </UiButton>

          <UiDivider style="margin: 18px 0">直接导入 Token</UiDivider>

          <UiButton
            size="small"
            quaternary
            @click="showImportToken = !showImportToken"
            style="margin-bottom: 8px"
          >
            {{ showImportToken ? '收起' : '展开' }} Token 手动导入
          </UiButton>
          <template v-if="showImportToken">
            <UiText depth="3" style="font-size: 12px">
              适合已有 Access Token / Refresh Token 的场景，跳过 OAuth 授权流程。
            </UiText>
            <UiInput
              v-model:value="importAccessToken"
              placeholder="Access Token（必填）"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 4 }"
              style="margin-top: 8px"
            />
            <UiInput
              v-model:value="importRefreshToken"
              placeholder="Refresh Token（可选）"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 3 }"
              style="margin-top: 8px"
            />
            <UiButton
              type="primary"
              size="small"
              :loading="busy"
              :disabled="!importAccessToken.trim()"
              style="margin-top: 10px; width: 100%"
              @click="finishImportToken"
            >
              导入 Token
            </UiButton>
          </template>
        </template>
      </div>

      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showAdd = false">取消</UiButton>
          <UiButton
            v-if="step === 'name' && form.provider === 'deepseek'"
            type="primary"
            :loading="busy"
            @click="finishDeepseekImport"
          >
            添加账户
          </UiButton>
          <UiButton
            v-else-if="step === 'name'"
            type="primary"
            :loading="busy"
            @click="startOAuth"
          >
            生成授权链接
          </UiButton>
          <UiButton
            v-else-if="oauthMode === 'paste'"
            type="primary"
            :loading="busy"
            @click="finishPaste"
          >
            完成授权
          </UiButton>
          <UiButton v-else type="primary" :loading="busy" @click="finishCallback">
            我已完成授权
          </UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal v-model:show="showGroups" :title="groupModalTitle" :width="groupModalWidth">
      <div v-if="!isGroupEditor" class="groups-manager">
        <div class="groups-toolbar">
          <div class="groups-toolbar-copy">
            <p class="group-hint">
              账号入组后只会被「绑定到该组的 Key」调度；未分组账号属于默认池，供未绑定分组的 Key 使用。
              倍率作用于计费：绑定该组的 Key 按「官方原始费用 × 倍率」扣费，1.0 为原价，可低于 1 折价。
            </p>
            <p class="groups-summary">
              {{ groups.length }} 个分组 · {{ groupedAccountTotal }} 个账号已入组
            </p>
          </div>
          <div class="groups-toolbar-actions">
            <UiButton size="small" secondary :loading="loadingGroups" @click="loadGroups">刷新</UiButton>
            <UiButton size="small" type="primary" @click="openCreateGroup">新建分组</UiButton>
          </div>
        </div>

        <div v-if="loadingGroups && !groups.length" class="group-empty-card">
          <span class="spinner group-loading-spinner" />
          <p>正在加载分组...</p>
        </div>
        <div v-else-if="!groups.length" class="group-empty-card">
          <strong>还没有分组</strong>
          <p>新建后即可在账号行和 Key 表单里选择分组。</p>
          <UiButton size="small" type="primary" @click="openCreateGroup">新建分组</UiButton>
        </div>
        <div v-else class="group-list">
          <div v-for="group in groups" :key="group.id" class="group-item">
            <div class="group-main">
              <div class="group-title-row">
                <strong class="group-name">{{ group.name }}</strong>
                <UiTag size="small" :type="rateMultiplierType(group.rateMultiplier)" :bordered="false">
                  {{ formatRateMultiplier(group.rateMultiplier) }}
                </UiTag>
              </div>
              <p class="group-description">{{ group.description || '暂无备注' }}</p>
              <span class="group-created">创建 {{ formatTime(group.createdAt) }}</span>
            </div>
            <div class="group-metrics" aria-label="分组统计">
              <div class="group-metric">
                <span>账号</span>
                <strong>{{ group.accountCount }}</strong>
              </div>
              <div class="group-metric">
                <span>计费</span>
                <strong>{{ formatRateMultiplier(group.rateMultiplier) }}</strong>
              </div>
            </div>
            <div class="group-actions">
              <UiButton size="small" quaternary @click="openEditGroup(group)">编辑</UiButton>
              <UiButton size="small" type="error" quaternary @click="confirmDeleteGroup(group)">删除</UiButton>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="group-form">
        <div class="group-form-field">
          <label class="field-label">分组名称</label>
          <UiInput
            v-model:value="groupForm.name"
            placeholder="例如：Claude 优先池"
            @keyup.enter="submitGroupForm"
          />
        </div>
        <div class="group-form-field">
          <label class="field-label">备注</label>
          <UiInput
            v-model:value="groupForm.description"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="可选，用于说明这个分组的用途"
          />
        </div>
        <div class="group-form-field">
          <label class="field-label">计费倍率</label>
          <UiInputNumber
            v-model:value="groupForm.rateMultiplier"
            :min="0.0001"
            :step="0.005"
            placeholder="1"
            style="width: 100%"
          />
          <p class="field-hint">绑定该组的 Key 按官方原始费用乘以该倍率扣费，1.0 为原价。</p>
        </div>
        <div class="group-preview">
          <div>
            <span>列表展示</span>
            <strong>{{ groupForm.name.trim() || '未命名分组' }}</strong>
          </div>
          <UiTag size="small" :type="rateMultiplierType(groupForm.rateMultiplier)" :bordered="false">
            {{ formatRateMultiplier(groupForm.rateMultiplier) }}
          </UiTag>
        </div>
      </div>

      <template #footer>
        <UiSpace justify="end">
          <template v-if="isGroupEditor">
            <UiButton @click="closeGroupEditor">返回列表</UiButton>
            <UiButton type="primary" :loading="savingGroup" @click="submitGroupForm">
              {{ groupSubmitLabel }}
            </UiButton>
          </template>
          <template v-else>
            <UiButton @click="showGroups = false">关闭</UiButton>
          </template>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.account-groups {
  display: grid;
  gap: 14px;
}

.account-group-card {
  overflow: hidden;
}

.account-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.account-group-title,
.account-group-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.account-group-title strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.account-group-meta {
  flex-wrap: wrap;
  justify-content: flex-end;
  color: rgba(15, 23, 42, 0.52);
  font-size: 12px;
}

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

:deep(.status-cell) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

:deep(.cooldown-hint-icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: rgba(240, 160, 32, 0.14);
  color: #c87900;
  cursor: help;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

:deep(.cooldown-hint-icon:hover),
:deep(.cooldown-hint-icon:focus-visible) {
  background: rgba(240, 160, 32, 0.22);
  outline: none;
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
  width: 22px;
  height: 22px;
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

:deep(.priority-input) {
  width: 82px;
}

:deep(.autopause-input) {
  width: 88px;
}

:deep(.group-select) {
  min-width: 120px;
}

.groups-manager {
  display: grid;
  gap: 14px;
}

.groups-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.groups-toolbar-copy {
  min-width: 0;
}

.groups-toolbar-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.group-hint {
  margin: 0;
  color: rgba(15, 23, 42, 0.6);
  font-size: 13px;
  line-height: 1.5;
}

.groups-summary {
  margin: 7px 0 0;
  color: rgba(15, 23, 42, 0.45);
  font-size: 12px;
  line-height: 1.35;
}

.group-list {
  display: grid;
  gap: 10px;
}

.group-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.72);
}

.group-main {
  min-width: 0;
}

.group-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.group-name {
  min-width: 0;
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-description {
  margin: 5px 0 0;
  overflow: hidden;
  color: rgba(15, 23, 42, 0.58);
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-created {
  display: block;
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.52);
  font-size: 12px;
  line-height: 1.35;
}

.group-metrics {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.group-metric {
  display: grid;
  gap: 2px;
  min-width: 66px;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.84);
  text-align: right;
}

.group-metric span,
.group-preview span {
  color: rgba(15, 23, 42, 0.48);
  font-size: 11px;
  line-height: 1.2;
}

.group-metric strong,
.group-preview strong {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
  white-space: nowrap;
}

.group-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.group-empty-card {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 30px 18px;
  border: 1px dashed rgba(148, 163, 184, 0.36);
  border-radius: 8px;
  color: rgba(15, 23, 42, 0.56);
  font-size: 13px;
  text-align: center;
}

.group-empty-card strong {
  color: #0f172a;
  font-size: 14px;
}

.group-empty-card p {
  margin: 0;
}

.group-loading-spinner {
  width: 18px;
  height: 18px;
  color: #2563eb;
}

.group-form {
  display: grid;
  gap: 16px;
}

.group-form-field {
  display: grid;
  gap: 6px;
}

.group-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(248, 250, 252, 0.74);
}

.group-preview > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.group-preview strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .group-hint {
  color: rgba(226, 232, 240, 0.62);
}

:global(.dark) .groups-summary,
:global(.dark) .group-created {
  color: rgba(226, 232, 240, 0.45);
}

:global(.dark) .group-item,
:global(.dark) .group-preview {
  border-color: rgba(71, 85, 105, 0.5);
  background: rgba(30, 41, 59, 0.52);
}

:global(.dark) .group-name,
:global(.dark) .group-metric strong,
:global(.dark) .group-preview strong,
:global(.dark) .group-empty-card strong {
  color: #f8fafc;
}

:global(.dark) .group-description,
:global(.dark) .group-empty-card {
  color: rgba(226, 232, 240, 0.58);
}

:global(.dark) .group-metric {
  background: rgba(15, 23, 42, 0.52);
}

:global(.dark) .group-metric span,
:global(.dark) .group-preview span {
  color: rgba(226, 232, 240, 0.46);
}

:global(.dark) .group-empty-card {
  border-color: rgba(71, 85, 105, 0.58);
}

@media (max-width: 720px) {
  .account-group-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .account-group-meta {
    justify-content: flex-start;
  }

  .groups-toolbar,
  .group-item {
    grid-template-columns: 1fr;
  }

  .groups-toolbar {
    display: grid;
  }

  .groups-toolbar-actions,
  .group-metrics,
  .group-actions {
    justify-content: flex-start;
  }

  .group-metrics {
    flex-wrap: wrap;
  }

  .group-metric {
    min-width: 78px;
    text-align: left;
  }
}
</style>
