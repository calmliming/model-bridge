<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { UiButton, UiInputNumber, UiSelect, UiSpace, UiSwitch, UiTag, UiTooltip } from '../components/ui'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'
import ImportAccountsModal from '../components/ImportAccountsModal.vue'

interface AccountQuotaWindow {
  key: 'hourly' | 'weekly' | 'weekly_sonnet' | 'weekly_fable' | 'primary' | 'secondary'
  label: string
  usedPercent: number | null
  resetAt: number | null
  exceeded: boolean
}

interface AccountQuotaSnapshot {
  source: 'claude' | 'openai'
  updatedAt: number
  windows: AccountQuotaWindow[]
  // OpenAI only: available rate-limit reset credits (null when unknown).
  resetCredits?: number | null
}

interface Sub2ApiBalanceSnapshot {
  totalBalance?: number
  used?: number
  remaining?: number
  resetAt?: number
  expiresAt?: number
  unlimited?: boolean
  hasSubscription?: boolean
  planName?: string
  currency?: string
  mode?: string
  endpoint?: string
  updatedAt: number
}

interface BatchQuotaRefreshResult {
  id: string
  success: boolean
  message?: string
  error?: string
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
  proxyUrl: string | null
  weight: number
  concurrencyLimit: number | null
  currentConcurrency: number
  lastUsedAt: number | null
  groups: AccountGroupRef[]
  notes: string | null
  createdAt: number
  quota: AccountQuotaSnapshot | null
  sub2apiBalance: Sub2ApiBalanceSnapshot | null
  // null = inherit global; 0 = auto-pause disabled; 1-100 = own threshold
  autopausePercent: number | null
  // Set when the refresh token permanently failed and the account was auto-disabled.
  reauth: { required: boolean; reason: string; provider: string; at: number } | null
  // Recent-window health derived from usage logs; score is null when no traffic.
  health: {
    score: number | null
    sampleSize: number
    successRate: number | null
    errorRate: number | null
    avgLatencyMs: number | null
  } | null
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

type Provider = 'claude' | 'openai' | 'gemini' | 'deepseek' | 'xiaomi' | 'zhipu' | 'qwen' | 'kimi' | 'grok' | 'sub2api'
type TagType = 'success' | 'warning' | 'error' | 'default' | 'info'

interface AccountGroup {
  provider: string
  accounts: Account[]
  activeCount: number
  coolingCount: number
  disabledCount: number
}

interface BulkEditForm {
  updateStatus: boolean
  status: 'active' | 'disabled'
  updateGroups: boolean
  groupIds: string[]
  updateWeight: boolean
  weight: number | null
  updateConcurrency: boolean
  concurrencyLimit: number | null
  updateNotes: boolean
  notes: string
  updateAutopause: boolean
  autopausePercent: number | null
}

const message = useMessage()
const dialog = useDialog()

const accounts = ref<Account[]>([])
const loading = ref(true)
const searchQuery = ref('')
const testingId = ref<string | null>(null)
const refreshingQuotaId = ref<string | null>(null)
const sub2ApiBalanceRefreshingIds = ref<Set<string>>(new Set())
const sub2ApiBalanceErrors = ref<Record<string, string>>({})
const resettingQuotaId = ref<string | null>(null)
const savingWeightId = ref<string | null>(null)
const savingConcurrencyId = ref<string | null>(null)
const savingNotesId = ref<string | null>(null)
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
const selectedAccountIdStrings = computed(() => selectedAccountIds.value.map(String))
const selectedAccounts = computed(() => {
  const ids = new Set(selectedAccountIdStrings.value)
  return accounts.value.filter((account) => ids.has(account.id))
})
const selectedCount = computed(() => selectedAccounts.value.length)
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
const apiKeyInput = ref('')
const baseUrlInput = ref('')
const busy = ref(false)
let refreshTimer: number | null = null
const sub2ApiBalanceLastAttemptAt = new Map<string, number>()
const SUB2API_BALANCE_MAX_AGE_MS = 5 * 60_000
const SUB2API_BALANCE_RETRY_DELAY_MS = 5 * 60_000
let sub2ApiBalanceRefreshRunning = false
let viewUnmounted = false

// Batch import modal state.
const showBatchImport = ref(false)
const selectedAccountIds = ref<Array<string | number>>([])
const bulkBusy = ref(false)
const showBulkEdit = ref(false)
const bulkForm = ref<BulkEditForm>({
  updateStatus: false,
  status: 'active',
  updateGroups: false,
  groupIds: [],
  updateWeight: false,
  weight: 1,
  updateConcurrency: false,
  concurrencyLimit: null,
  updateNotes: false,
  notes: '',
  updateAutopause: false,
  autopausePercent: null,
})

const providerLabel: Record<Provider, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  xiaomi: 'Xiaomi MiMo',
  zhipu: 'Zhipu GLM',
  qwen: 'Tongyi Qwen',
  kimi: 'Kimi (Moonshot)',
  grok: 'Grok (xAI)',
  sub2api: 'Sub2API',
}
const providerOrder: Provider[] = ['claude', 'openai', 'gemini', 'deepseek', 'xiaomi', 'zhipu', 'qwen', 'kimi', 'grok', 'sub2api']
const providerTagType: Record<Provider, TagType> = {
  claude: 'error',
  openai: 'success',
  gemini: 'warning',
  deepseek: 'info',
  xiaomi: 'warning',
  zhipu: 'info',
  qwen: 'info',
  kimi: 'default',
  grok: 'default',
  sub2api: 'success',
}
const authorizeHost: Record<Provider, string> = {
  claude: 'claude.ai',
  openai: 'auth.openai.com',
  gemini: 'accounts.google.com',
  deepseek: 'platform.deepseek.com',
  xiaomi: 'platform.xiaomimimo.com',
  zhipu: 'open.bigmodel.cn',
  qwen: 'bailian.console.aliyun.com',
  kimi: 'platform.moonshot.cn',
  grok: 'auth.x.ai',
  sub2api: 'sub2api',
}

// Providers that authenticate with a plain API key (no OAuth flow). They share
// the single-step "粘贴 API Key" form below.
const API_KEY_PROVIDERS: Provider[] = ['deepseek', 'xiaomi', 'zhipu', 'qwen', 'kimi', 'sub2api']
function isApiKeyProvider(provider: Provider): boolean {
  return API_KEY_PROVIDERS.includes(provider)
}
const apiKeyConsoleHint: Record<string, string> = {
  deepseek: '在 platform.deepseek.com/api_keys 创建 API Key 后粘贴到上方。',
  xiaomi: '在 platform.xiaomimimo.com 控制台「API-Keys」创建 API Key 后粘贴到上方。',
  zhipu: '在 open.bigmodel.cn 控制台「API Keys」创建 API Key 后粘贴到上方。',
  qwen: '在 bailian.console.aliyun.com 阿里云百炼控制台「API-KEY」创建后粘贴到上方。',
  kimi: '在 platform.moonshot.cn 控制台「API Key 管理」创建 API Key 后粘贴到上方。',
  sub2api: '填写 Sub2API 部署地址和它生成的 API Key，例如 https://sub2api.example.com。',
}

const statusMeta: Record<string, { label: string; type: TagType }> = {
  active: { label: '正常', type: 'success' },
  rate_limited: { label: '限流冷却', type: 'warning' },
  error: { label: '异常', type: 'error' },
  disabled: { label: '已禁用', type: 'default' },
}
const bulkStatusOptions = [
  { label: '启用调度', value: 'active' },
  { label: '禁用调度', value: 'disabled' },
]

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

function isFiniteBalance(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatSub2ApiAmount(value: number | null | undefined, currency?: string): string {
  if (!isFiniteBalance(value)) return '—'
  const unit = currency?.trim().toUpperCase() || 'USD'
  try {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: unit,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${unit}`
  }
}

function sub2ApiBalanceStatus(snapshot: Sub2ApiBalanceSnapshot): TagType {
  if (snapshot.unlimited) return 'success'
  if (!isFiniteBalance(snapshot.remaining)) return 'default'
  if (snapshot.remaining <= 0) return 'error'
  if (
    isFiniteBalance(snapshot.totalBalance) &&
    snapshot.totalBalance > 0 &&
    snapshot.remaining / snapshot.totalBalance <= 0.2
  ) {
    return 'warning'
  }
  return 'success'
}

function sub2ApiModeLabel(snapshot: Sub2ApiBalanceSnapshot): string | null {
  if (snapshot.hasSubscription) return '订阅'
  if (snapshot.mode === 'unrestricted') return '钱包'
  if (snapshot.mode === 'quota_limited') return 'Key 限额'
  return snapshot.mode ?? null
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
  if (window.key === 'weekly_fable') return '7天 Fable'
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

function renderReauthBadge(row: Account) {
  if (!row.reauth?.required) return null
  const tip = `refresh token 已失效（${row.reauth.reason}），请重新授权 · ${formatShortTime(row.reauth.at)}`
  return h(
    UiTooltip,
    { placement: 'top', trigger: 'hover' },
    {
      trigger: () =>
        h(UiTag, { size: 'small', type: 'error', bordered: false }, { default: () => '需重新授权' }),
      default: () => tip,
    },
  )
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
        renderReauthBadge(row),
        isCoolingDown(row)
          ? h('span', { class: 'muted-cell' }, `至 ${formatShortTime(row.cooldownUntil)}`)
          : null,
      ],
    },
  )
}

function healthTagType(score: number): TagType {
  if (score >= 90) return 'success'
  if (score >= 70) return 'info'
  if (score >= 40) return 'warning'
  return 'error'
}

function renderHealth(row: Account) {
  const health = row.health
  if (!health || health.score == null) {
    return h('span', { class: 'muted-cell', title: '近 6 小时无请求，暂无健康数据' }, '暂无')
  }
  const score = health.score
  const parts: string[] = []
  if (health.successRate != null) parts.push(`成功率 ${(health.successRate * 100).toFixed(0)}%`)
  if (health.avgLatencyMs != null) parts.push(`平均延迟 ${health.avgLatencyMs}ms`)
  parts.push(`样本 ${health.sampleSize}`)
  const tip = `近 6 小时 · ${parts.join(' · ')}`
  return h(
    UiTooltip,
    { placement: 'top', trigger: 'hover' },
    {
      trigger: () =>
        h(UiTag, { size: 'small', type: healthTagType(score), bordered: false }, { default: () => `${score}/100` }),
      default: () => tip,
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

function sub2ApiBalanceRefreshError(row: Account): string | null {
  return row.provider === 'sub2api' ? sub2ApiBalanceErrors.value[row.id] ?? null : null
}

function isSub2ApiBalanceRefreshing(row: Account): boolean {
  return row.provider === 'sub2api' && sub2ApiBalanceRefreshingIds.value.has(row.id)
}

function setSub2ApiBalanceError(id: string, error: string | null) {
  const next = { ...sub2ApiBalanceErrors.value }
  if (error) next[id] = error
  else delete next[id]
  sub2ApiBalanceErrors.value = next
}

function applySub2ApiBalanceRefreshResults(ids: string[], results: BatchQuotaRefreshResult[]) {
  const resultsById = new Map(results.map((result) => [result.id, result]))
  for (const id of ids) {
    const result = resultsById.get(id)
    setSub2ApiBalanceError(
      id,
      result?.success ? null : result?.error || result?.message || '第三方站点未返回余额查询结果',
    )
  }
}

function renderQuotaRefresh(row: Account, updatedAt?: number | null, showError = true) {
  const refreshing = refreshingQuotaId.value === row.id || isSub2ApiBalanceRefreshing(row)
  const refreshError = sub2ApiBalanceRefreshError(row)
  return h(
    'div',
    { class: 'quota-refresh-wrap' },
    [
      updatedAt ? h('span', { class: 'quota-updated' }, formatRelativePast(updatedAt)) : null,
      showError && refreshError
        ? h('span', { class: 'quota-refresh-error', title: refreshError }, '查询失败')
        : null,
      h(
        UiButton,
        {
          size: 'tiny',
          quaternary: true,
          circle: true,
          title: row.provider === 'sub2api' ? '刷新余额' : '刷新配额',
          'aria-label': row.provider === 'sub2api' ? '刷新余额' : '刷新配额',
          // Don't use `loading`: UiButton renders its own generic spinner *next
          // to* the slot icon. Instead spin the ↻ glyph itself and just disable
          // the button while the request is in flight.
          disabled: refreshing,
          class: 'quota-refresh',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            void refreshQuota(row)
          },
        },
        {
          default: () =>
            h(
              'svg',
              {
                class: ['quota-refresh-icon', { 'is-spinning': refreshing }],
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                'aria-hidden': 'true',
              },
              [
                h('path', {
                  'stroke-linecap': 'round',
                  'stroke-linejoin': 'round',
                  'stroke-width': '2',
                  // Two-arrow refresh icon with 180° rotational symmetry, so the
                  // spin animation reads as a smooth continuous rotation.
                  d: 'M20 11A8 8 0 0 0 5.5 7M4 4v3.5h3.5M4 13a8 8 0 0 0 14.5 4M20 20v-3.5h-3.5',
                }),
              ],
            ),
        },
      ),
    ],
  )
}

function renderSub2ApiBalance(row: Account) {
  const balance = row.sub2apiBalance
  if (!balance) {
    const refreshError = sub2ApiBalanceRefreshError(row)
    const refreshing = refreshingQuotaId.value === row.id || isSub2ApiBalanceRefreshing(row)
    const label = refreshing ? '正在查询第三方余额...' : refreshError ? '查询失败' : '等待查询'
    return h('div', { class: 'quota-cell' }, [
      h('div', { class: 'quota-line' }, [
        h(
          'span',
          {
            class: ['sub2api-balance-state', { 'is-error': Boolean(refreshError) }],
            title: refreshError ?? undefined,
          },
          label,
        ),
      ]),
      renderQuotaRefresh(row, undefined, false),
    ])
  }

  const status = sub2ApiBalanceStatus(balance)
  const hasRemaining = isFiniteBalance(balance.remaining)
  const primaryText = balance.unlimited
    ? '不限额'
    : hasRemaining
      ? `剩余 ${formatSub2ApiAmount(balance.remaining, balance.currency)}`
      : '上游未返回金额'
  const details: string[] = []
  const modeLabel = sub2ApiModeLabel(balance)
  if (modeLabel) details.push(modeLabel)
  if (balance.planName && balance.planName !== '钱包余额') details.push(balance.planName)
  if (isFiniteBalance(balance.totalBalance)) {
    details.push(`总额 ${formatSub2ApiAmount(balance.totalBalance, balance.currency)}`)
  }
  if (isFiniteBalance(balance.used)) {
    details.push(`已用 ${formatSub2ApiAmount(balance.used, balance.currency)}`)
  }
  if (isFiniteBalance(balance.resetAt)) details.push(`重置 ${formatShortTime(balance.resetAt)}`)
  if (isFiniteBalance(balance.expiresAt)) details.push(`到期 ${formatShortTime(balance.expiresAt)}`)
  const detailText = details.join(' · ')

  return h('div', { class: 'quota-cell sub2api-balance-cell' }, [
    h('div', { class: 'quota-line' }, [
      h(
        'span',
        { class: ['sub2api-balance-remaining', `is-${status}`] },
        primaryText,
      ),
      detailText
        ? h('span', { class: 'sub2api-balance-detail', title: detailText }, detailText)
        : null,
    ]),
    renderQuotaRefresh(row, balance.updatedAt),
  ])
}

function renderResetCredits(row: Account) {
  // OpenAI-only: surface the reset-credit balance, when known, next to the
  // quota windows. `null`/undefined means we haven't queried it yet.
  if (row.provider !== 'openai') return null
  const credits = row.quota?.resetCredits
  if (typeof credits !== 'number') return null
  return h(
    UiTag,
    { size: 'small', type: credits > 0 ? 'success' : 'default', round: true, class: 'quota-credits' },
    { default: () => `Reset credit ×${credits}` },
  )
}

function renderQuota(row: Account) {
  if (row.provider === 'sub2api') return renderSub2ApiBalance(row)
  const quota = row.quota
  const credits = renderResetCredits(row)
  if (!quota || !quota.windows.length) {
    return h('div', { class: 'quota-cell' }, [
      h('div', { class: 'quota-line' }, [h('span', { class: 'muted-cell' }, '未更新'), credits]),
      renderQuotaRefresh(row, quota?.updatedAt),
    ])
  }
  return h(
    'div',
    { class: 'quota-cell' },
    [
      h('div', { class: 'quota-line' }, [
        ...quota.windows.map(renderQuotaWindow),
        credits,
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

function renderConcurrency(row: Account) {
  return h('div', { class: 'concurrency-cell' }, [
    h(UiInputNumber, {
      value: row.concurrencyLimit,
      min: 1,
      max: 1000,
      precision: 0,
      size: 'small',
      placeholder: '不限',
      disabled: savingConcurrencyId.value === row.id,
      class: 'concurrency-input',
      title: '该上游账号同时在途请求数上限，清空表示不限。',
      'aria-label': `${row.name} 账号并发上限`,
      onUpdateValue: (value: number | null) => {
        void updateConcurrency(row, value)
      },
    }),
    h('span', { class: 'muted-cell concurrency-now' }, `当前 ${row.currentConcurrency ?? 0}`),
  ])
}

function renderNotes(row: Account) {
  return h('input', {
    class: 'input notes-input',
    value: row.notes ?? '',
    placeholder: '备注',
    disabled: savingNotesId.value === row.id,
    title: row.notes ?? '',
    'aria-label': `${row.name} 备注`,
    onChange: (event: Event) => {
      void updateNotes(row, (event.target as HTMLInputElement).value)
    },
    onKeyup: (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        ;(event.target as HTMLInputElement).blur()
      }
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

function shouldRefreshSub2ApiBalance(account: Account, now: number): boolean {
  if (account.provider !== 'sub2api') return false
  const updatedAt = account.sub2apiBalance?.updatedAt
  if (updatedAt && now - updatedAt < SUB2API_BALANCE_MAX_AGE_MS) return false
  const lastAttemptAt = sub2ApiBalanceLastAttemptAt.get(account.id)
  return lastAttemptAt == null || now - lastAttemptAt >= SUB2API_BALANCE_RETRY_DELAY_MS
}

async function refreshStaleSub2ApiBalances(loadedAccounts: Account[]) {
  if (sub2ApiBalanceRefreshRunning || viewUnmounted) return

  const now = Date.now()
  const targets = loadedAccounts.filter((account) => shouldRefreshSub2ApiBalance(account, now))
  if (!targets.length) return

  sub2ApiBalanceRefreshRunning = true
  sub2ApiBalanceRefreshingIds.value = new Set(targets.map((account) => account.id))
  for (const account of targets) {
    sub2ApiBalanceLastAttemptAt.set(account.id, now)
    setSub2ApiBalanceError(account.id, null)
  }

  try {
    const { data } = await api.post('/admin/accounts/batch-quota-refresh', {
      ids: targets.map((account) => account.id),
    })
    const results: BatchQuotaRefreshResult[] = Array.isArray(data?.results) ? data.results : []
    applySub2ApiBalanceRefreshResults(targets.map((account) => account.id), results)
    if (!viewUnmounted) await load()
  } catch (e) {
    const error = errMsg(e, '查询第三方余额失败')
    for (const account of targets) setSub2ApiBalanceError(account.id, error)
  } finally {
    sub2ApiBalanceRefreshingIds.value = new Set()
    sub2ApiBalanceRefreshRunning = false
  }
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/accounts')
    accounts.value = data.accounts
    pruneSelectedAccounts()
    void refreshStaleSub2ApiBalances(accounts.value)
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
  apiKeyInput.value = ''
  baseUrlInput.value = ''
  showAdd.value = true
}

function openBatchImport() {
  showBatchImport.value = true
}

async function handleBatchImported() {
  await load()
}

function resetBulkForm() {
  bulkForm.value = {
    updateStatus: false,
    status: 'active',
    updateGroups: false,
    groupIds: [],
    updateWeight: false,
    weight: 1,
    updateConcurrency: false,
    concurrencyLimit: null,
    updateNotes: false,
    notes: '',
    updateAutopause: false,
    autopausePercent: null,
  }
}

function pruneSelectedAccounts() {
  const ids = new Set(accounts.value.map((account) => account.id))
  selectedAccountIds.value = selectedAccountIds.value.filter((id) => ids.has(String(id)))
}

function selectAllAccounts() {
  selectedAccountIds.value = accounts.value.map((account) => account.id)
}

function clearSelectedAccounts() {
  selectedAccountIds.value = []
}

function requireSelectedIds(): string[] | null {
  const ids = selectedAccountIdStrings.value
  if (!ids.length) {
    message.warning('请先选择账户')
    return null
  }
  return ids
}

function notifyBatchResult(action: string, data: { successCount: number; failureCount: number }) {
  if (data.failureCount > 0) {
    message.warning(`${action}完成：成功 ${data.successCount} 个，失败 ${data.failureCount} 个`)
    return
  }
  message.success(`${action}完成：${data.successCount} 个账户`)
}

async function bulkUpdateSelected(patch: Record<string, unknown>, action: string) {
  const ids = requireSelectedIds()
  if (!ids) return false
  bulkBusy.value = true
  try {
    const { data } = await api.post('/admin/accounts/bulk-update', { ids, patch })
    notifyBatchResult(action, data)
    await load()
    if (patch.groupIds !== undefined) await loadGroups()
    return data.failureCount === 0
  } catch (e) {
    message.error(errMsg(e, `${action}失败`))
    return false
  } finally {
    bulkBusy.value = false
  }
}

function openBulkEdit() {
  if (!requireSelectedIds()) return
  resetBulkForm()
  showBulkEdit.value = true
}

function buildBulkPatch(): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  const form = bulkForm.value
  if (form.updateStatus) patch.status = form.status
  if (form.updateGroups) patch.groupIds = form.groupIds
  if (form.updateWeight) {
    if (form.weight == null || !Number.isFinite(form.weight)) {
      message.warning('请填写有效优先级')
      return null
    }
    patch.weight = Math.max(1, Math.min(100, Math.trunc(form.weight)))
  }
  if (form.updateConcurrency) {
    patch.concurrencyLimit = form.concurrencyLimit == null
      ? null
      : Math.max(1, Math.min(1000, Math.trunc(form.concurrencyLimit)))
  }
  if (form.updateNotes) patch.notes = form.notes.trim() || null
  if (form.updateAutopause) {
    patch.autopausePercent = form.autopausePercent == null
      ? null
      : Math.max(0, Math.min(100, Math.trunc(form.autopausePercent)))
  }
  if (!Object.keys(patch).length) {
    message.warning('请选择至少一个要批量更新的字段')
    return null
  }
  return patch
}

async function submitBulkEdit() {
  const patch = buildBulkPatch()
  if (!patch) return
  const ok = await bulkUpdateSelected(patch, '批量更新')
  if (ok) showBulkEdit.value = false
}

async function bulkSetStatus(status: 'active' | 'disabled') {
  await bulkUpdateSelected({ status }, status === 'active' ? '批量启用' : '批量禁用')
}

async function batchTestSelected() {
  const ids = requireSelectedIds()
  if (!ids) return
  bulkBusy.value = true
  try {
    const { data } = await api.post('/admin/accounts/batch-test', { ids })
    notifyBatchResult('批量测试', data)
    await load()
  } catch (e) {
    message.error(errMsg(e, '批量测试失败'))
  } finally {
    bulkBusy.value = false
  }
}

async function batchRefreshQuotaSelected() {
  const ids = requireSelectedIds()
  if (!ids) return
  const sub2ApiIds = selectedAccounts.value
    .filter((account) => account.provider === 'sub2api')
    .map((account) => account.id)
  const attemptedAt = Date.now()
  for (const id of sub2ApiIds) {
    sub2ApiBalanceLastAttemptAt.set(id, attemptedAt)
    setSub2ApiBalanceError(id, null)
  }
  bulkBusy.value = true
  try {
    const { data } = await api.post('/admin/accounts/batch-quota-refresh', { ids })
    const results: BatchQuotaRefreshResult[] = Array.isArray(data?.results) ? data.results : []
    applySub2ApiBalanceRefreshResults(sub2ApiIds, results)
    notifyBatchResult('批量刷新余额/配额', data)
    await load()
  } catch (e) {
    const error = errMsg(e, '批量刷新余额/配额失败')
    for (const id of sub2ApiIds) setSub2ApiBalanceError(id, error)
    message.error(error)
  } finally {
    bulkBusy.value = false
  }
}

function confirmBulkDelete() {
  const ids = requireSelectedIds()
  if (!ids) return
  const names = selectedAccounts.value.slice(0, 5).map((account) => `「${account.name}」`).join('、')
  const suffix = selectedCount.value > 5 ? ` 等 ${selectedCount.value} 个账户` : ''
  dialog.warning({
    title: '批量删除账户',
    content: `确定删除 ${names}${suffix}？这些账户将不再参与中转。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      bulkBusy.value = true
      try {
        const { data } = await api.post('/admin/accounts/bulk-delete', { ids })
        notifyBatchResult('批量删除', data)
        const failedIds = new Set<string>(
          (data.results ?? []).filter((item: { id: string; success: boolean }) => !item.success).map((item: { id: string }) => item.id),
        )
        selectedAccountIds.value = selectedAccountIds.value.filter((id) => failedIds.has(String(id)))
        await load()
        await loadGroups()
      } catch (e) {
        message.error(errMsg(e, '批量删除失败'))
      } finally {
        bulkBusy.value = false
      }
    },
  })
}

async function finishApiKeyImport() {
  const provider = form.value.provider
  const label = providerLabel[provider]
  if (!form.value.name.trim()) {
    message.warning('请填写账户名称')
    return
  }
  if (!apiKeyInput.value.trim()) {
    message.warning(`请填写 ${label} API Key`)
    return
  }
  if (provider === 'sub2api' && !baseUrlInput.value.trim()) {
    message.warning('请填写 Sub2API Base URL')
    return
  }
  busy.value = true
  try {
    const payload: Record<string, unknown> = {
      provider,
      name: form.value.name.trim(),
      accessToken: apiKeyInput.value.trim(),
    }
    if (provider === 'sub2api') payload.baseUrl = baseUrlInput.value.trim()
    await api.post('/admin/accounts/import/token', payload)
    message.success(`${label} 账户已添加`)
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

async function updateConcurrency(row: Account, value: number | null) {
  const next = value == null ? null : Math.max(1, Math.min(1000, Math.trunc(value)))
  if (next === row.concurrencyLimit) return

  const previous = row.concurrencyLimit
  row.concurrencyLimit = next
  savingConcurrencyId.value = row.id
  try {
    await api.patch(`/admin/accounts/${row.id}`, { concurrencyLimit: next })
  } catch (e) {
    row.concurrencyLimit = previous
    message.error(errMsg(e, '更新账号并发失败'))
  } finally {
    if (savingConcurrencyId.value === row.id) savingConcurrencyId.value = null
  }
}

async function updateNotes(row: Account, value: string) {
  const next = value.trim()
  const normalized = next || null
  if (normalized === (row.notes ?? null)) return

  const previous = row.notes
  row.notes = normalized
  savingNotesId.value = row.id
  try {
    await api.patch(`/admin/accounts/${row.id}`, { notes: normalized })
  } catch (e) {
    row.notes = previous
    message.error(errMsg(e, '更新备注失败'))
  } finally {
    if (savingNotesId.value === row.id) savingNotesId.value = null
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
  const isSub2Api = row.provider === 'sub2api'
  if (isSub2Api) {
    sub2ApiBalanceLastAttemptAt.set(row.id, Date.now())
    setSub2ApiBalanceError(row.id, null)
  }
  try {
    // OpenAI OAuth accounts have a dedicated endpoint that also returns the
    // reset-credit balance. Sub2API uses the generic route backed by /v1/usage.
    if (row.provider === 'openai') {
      const { data } = await api.get(`/admin/accounts/${row.id}/openai/quota`)
      if (data.success) {
        message.success('配额已刷新')
        await load()
        return
      }
      message.error(data.error || '刷新配额失败')
      return
    }
    const { data } = await api.post(`/admin/accounts/${row.id}/quota/refresh`)
    if (data.success && isSub2Api) {
      setSub2ApiBalanceError(row.id, null)
      message.success('余额已更新')
      await load()
      return
    }
    if (data.success) {
      message.success('配额已刷新')
      await load()
      return
    }
    const label = row.provider === 'sub2api' ? '余额' : '配额'
    const error = data.message || `刷新${label}失败`
    if (isSub2Api) setSub2ApiBalanceError(row.id, error)
    message.error(error)
  } catch (e) {
    const label = row.provider === 'sub2api' ? '余额' : '配额'
    const error = errMsg(e, `刷新${label}失败`)
    if (isSub2Api) setSub2ApiBalanceError(row.id, error)
    message.error(error)
  } finally {
    refreshingQuotaId.value = null
  }
}

function confirmResetQuota(row: Account) {
  const credits = row.quota?.resetCredits
  const creditHint = typeof credits === 'number' ? `当前剩余 ${credits} 次。` : ''
  dialog.warning({
    title: '重置限额',
    content: `确定为「${row.name}」消耗一次上游 reset credit 吗？该操作会立即重置限额窗口，且不可撤销。${creditHint}`,
    positiveText: '重置',
    negativeText: '取消',
    onPositiveClick: async () => {
      resettingQuotaId.value = row.id
      try {
        const { data } = await api.post(`/admin/accounts/${row.id}/openai/reset-quota`)
        if (data.success) {
          message.success(data.message || '已重置限额')
          await load()
          return
        }
        message.error(data.error || '重置限额失败')
      } catch (e) {
        message.error(errMsg(e, '重置限额失败'))
      } finally {
        resettingQuotaId.value = null
      }
    },
  })
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

function accountRowKey(row: Account) {
  return row.id
}

const columns = computed<TableColumn<Account>[]>(() => [
  { title: '账户', key: 'name', minWidth: 200, fixed: 'left', render: renderAccount },
  { title: '分组', key: 'group', width: 240, render: renderGroupCell },
  {
    title: '状态',
    key: 'status',
    width: 110,
    render: renderStatus,
  },
  { title: '健康分', key: 'health', width: 92, render: renderHealth },
  { title: '访问令牌刷新', key: 'tokenExpiresAt', minWidth: 150, render: (row) => formatTime(row.tokenExpiresAt) },
  { title: '余额 / 配额', key: 'quota', minWidth: 330, render: renderQuota },
  { title: '停调阈值', key: 'autopause', width: 116, render: renderAutopause },
  { title: '并发', key: 'concurrencyLimit', width: 132, render: renderConcurrency },
  { title: '优先级', key: 'weight', width: 110, render: renderPriority },
  { title: '备注', key: 'notes', minWidth: 170, render: renderNotes },
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
    width: 180,
    fixed: 'right',
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
                title: '测试连通性',
              },
              {
                default: () => h('div', { class: 'flex items-center gap-1' }, [
                  h('svg', { class: 'w-3.5 h-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
                    h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M13 10V3L4 14h7v7l9-11h-7z' })
                  ]),
                  h('span', '测试')
                ])
              },
            ),
            // Reset quota: OpenAI OAuth accounts only — consumes an upstream credit.
            row.provider === 'openai'
              ? h(
                  UiButton,
                  {
                    size: 'small',
                    type: 'warning',
                    quaternary: true,
                    loading: resettingQuotaId.value === row.id,
                    onClick: () => confirmResetQuota(row),
                    title: '重置限额（消耗一次 reset credit）',
                  },
                  {
                    default: () => h('div', { class: 'flex items-center gap-1' }, [
                      h('svg', { class: 'w-3.5 h-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
                        h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' })
                      ]),
                      h('span', '重置')
                    ])
                  },
                )
              : null,
            h(
              UiButton,
              {
                size: 'small',
                type: 'error',
                quaternary: true,
                onClick: () => confirmDelete(row),
                title: '删除账户',
              },
              {
                default: () => h('div', { class: 'flex items-center gap-1' }, [
                  h('svg', { class: 'w-3.5 h-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, [
                    h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' })
                  ]),
                  h('span', '删除')
                ])
              },
            ),
          ],
        },
      ),
  },
])

const OAUTH_TOKEN_PROVIDERS = new Set<Provider>(['claude', 'openai', 'gemini'])

function columnsForProvider(provider: string): TableColumn<Account>[] {
  return columns.value
    .filter((column) => column.key !== 'tokenExpiresAt' || OAUTH_TOKEN_PROVIDERS.has(provider as Provider))
    .map((column) =>
      provider === 'sub2api' && column.key === 'quota'
        ? { ...column, minWidth: 190 }
        : column,
    )
}

function tableScrollWidth(provider: string): number {
  if (provider === 'sub2api') return 1780
  return OAUTH_TOKEN_PROVIDERS.has(provider as Provider) ? 2070 : 1920
}

const accountGroups = computed<AccountGroup[]>(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const filteredAccounts = query
    ? accounts.value.filter(
        (a) => a.name.toLowerCase().includes(query) || a.provider.toLowerCase().includes(query),
      )
    : accounts.value

  const groups = new Map<string, Account[]>()
  for (const account of filteredAccounts) {
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
  viewUnmounted = true
  if (refreshTimer != null) window.clearInterval(refreshTimer)
})
</script>

<template>
  <div>
    <div class="page-head">
      <div class="flex flex-1 items-center gap-3">
        <div class="relative w-full max-w-[280px]">
          <span class="absolute inset-y-0 left-3 flex items-center text-gray-400">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </span>
          <input
            v-model="searchQuery"
            type="text"
            class="input !pl-9"
            placeholder="搜索账户名称或服务商..."
          />
        </div>
      </div>
      <div class="flex flex-shrink-0 items-center gap-2">
        <UiButton secondary @click="openGroups">
          <template #default>
            <div class="flex items-center gap-1.5">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
              <span>管理分组</span>
            </div>
          </template>
        </UiButton>
        <UiButton secondary @click="openBatchImport">
          <template #default>
            <div class="flex items-center gap-1.5">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span>批量导入</span>
            </div>
          </template>
        </UiButton>
        <UiButton type="primary" @click="openAdd">
          <template #default>
            <div class="flex items-center gap-1.5">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span>添加账户</span>
            </div>
          </template>
        </UiButton>
      </div>
    </div>

    <Transition name="fade">
      <div v-if="selectedCount > 0" class="bulk-actions sticky top-0 z-20 shadow-lg backdrop-blur-md">
        <div class="bulk-summary">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-600 dark:bg-primary-900/40 dark:text-primary-300">
            {{ selectedCount }}
          </span>
          <strong>已选中账户</strong>
          <div class="bulk-selection-tools ml-2">
            <UiButton size="tiny" quaternary :disabled="bulkBusy" @click="clearSelectedAccounts">取消选择</UiButton>
          </div>
        </div>
        <div class="bulk-buttons">
          <UiButton size="small" secondary :disabled="bulkBusy" @click="batchTestSelected">批量测试</UiButton>
          <UiButton size="small" secondary :disabled="bulkBusy" @click="batchRefreshQuotaSelected">刷新余额/配额</UiButton>
          <div class="h-4 w-px bg-gray-200 dark:bg-dark-700 mx-1"></div>
          <UiButton size="small" type="success" secondary :disabled="bulkBusy" @click="bulkSetStatus('active')">启用</UiButton>
          <UiButton size="small" type="warning" secondary :disabled="bulkBusy" @click="bulkSetStatus('disabled')">禁用</UiButton>
          <UiButton size="small" type="primary" :disabled="bulkBusy" @click="openBulkEdit">批量编辑</UiButton>
          <UiButton size="small" type="error" secondary :disabled="bulkBusy" @click="confirmBulkDelete">删除</UiButton>
        </div>
      </div>
    </Transition>

    <div v-if="accountGroups.length" class="account-groups">
      <UiCard
        v-for="group in accountGroups"
        :key="group.provider"
        class="table-card account-group-card"
        :bordered="false"
        :padding="false"
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
          class="account-table"
          :columns="columnsForProvider(group.provider)"
          :data="group.accounts"
          :loading="loading"
          selectable
          v-model:checked-row-keys="selectedAccountIds"
          :row-key="accountRowKey"
          :bordered="false"
          :scroll-x="tableScrollWidth(group.provider)"
        />
      </UiCard>
    </div>

    <UiCard v-else class="table-card account-table-shell" :bordered="false" :padding="false">
      <UiDataTable
        class="account-table"
        :columns="columns"
        :data="accounts"
        :loading="loading"
        selectable
        v-model:checked-row-keys="selectedAccountIds"
        :row-key="accountRowKey"
        :bordered="false"
        :scroll-x="2070"
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
              <UiRadioButton value="xiaomi">Xiaomi MiMo</UiRadioButton>
              <UiRadioButton value="zhipu">Zhipu GLM</UiRadioButton>
              <UiRadioButton value="qwen">Tongyi Qwen</UiRadioButton>
              <UiRadioButton value="kimi">Kimi (Moonshot)</UiRadioButton>
              <UiRadioButton value="sub2api">Sub2API</UiRadioButton>
            </UiRadioGroup>
          </UiFormItem>
          <UiFormItem label="账户名称">
            <UiInput
              v-model:value="form.name"
              :placeholder="`例如：我的 ${providerLabel[form.provider]}`"
            />
          </UiFormItem>
          <UiFormItem v-if="isApiKeyProvider(form.provider)" label="API Key">
            <UiInput
              v-model:value="apiKeyInput"
              placeholder="sk-..."
              type="password"
              show-password-on="click"
            />
          </UiFormItem>
          <UiFormItem
            v-if="form.provider === 'sub2api'"
            label="Base URL"
            hint="填部署根地址即可，末尾带不带 /v1 都行（会自动归一化后拼 /v1/messages、/v1/chat/completions、/v1/responses）。若上游是 OpenAI 兼容中转且报路径错误，通常是它的实际路径与标准 /v1/* 不一致，需按其文档调整地址结尾。"
          >
            <UiInput
              v-model:value="baseUrlInput"
              placeholder="https://sub2api.example.com"
            />
          </UiFormItem>
        </UiForm>
        <UiText v-if="!isApiKeyProvider(form.provider)" depth="3" style="font-size: 13px">
          下一步会生成 {{ authorizeHost[form.provider] }} 的授权链接；
          你需要用拥有该订阅的账号登录并授权。
        </UiText>
        <UiText v-else depth="3" style="font-size: 13px">
          {{ apiKeyConsoleHint[form.provider] }}
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
            v-if="step === 'name' && isApiKeyProvider(form.provider)"
            type="primary"
            :loading="busy"
            @click="finishApiKeyImport"
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

    <UiModal v-model:show="showBulkEdit" title="批量编辑账户" :width="620">
      <div class="bulk-edit">
        <div class="bulk-edit-note">
          <strong>{{ selectedCount }} 个账户</strong>
          <span>只会更新已勾选的字段，未勾选字段保持不变。</span>
        </div>

        <div class="bulk-edit-row">
          <UiCheckbox v-model:checked="bulkForm.updateStatus">调度状态</UiCheckbox>
          <UiSelect
            v-model:value="bulkForm.status"
            :options="bulkStatusOptions"
            :disabled="!bulkForm.updateStatus"
          />
        </div>

        <div class="bulk-edit-row">
          <UiCheckbox v-model:checked="bulkForm.updateGroups">分组</UiCheckbox>
          <UiSelect
            v-model:value="bulkForm.groupIds"
            multiple
            clearable
            :options="groupSelectOptions"
            :disabled="!bulkForm.updateGroups"
            placeholder="默认池"
          />
        </div>

        <div class="bulk-edit-grid">
          <div class="bulk-edit-row is-compact">
            <UiCheckbox v-model:checked="bulkForm.updateWeight">优先级</UiCheckbox>
            <UiInputNumber
              v-model:value="bulkForm.weight"
              :min="1"
              :max="100"
              :disabled="!bulkForm.updateWeight"
            />
          </div>

          <div class="bulk-edit-row is-compact">
            <UiCheckbox v-model:checked="bulkForm.updateConcurrency">并发上限</UiCheckbox>
            <UiInputNumber
              v-model:value="bulkForm.concurrencyLimit"
              :min="1"
              :max="1000"
              :disabled="!bulkForm.updateConcurrency"
              placeholder="不限"
            />
          </div>

          <div class="bulk-edit-row is-compact">
            <UiCheckbox v-model:checked="bulkForm.updateAutopause">停调阈值</UiCheckbox>
            <UiInputNumber
              v-model:value="bulkForm.autopausePercent"
              :min="0"
              :max="100"
              :step="5"
              :disabled="!bulkForm.updateAutopause"
              placeholder="继承全局"
            />
          </div>
        </div>

        <div class="bulk-edit-row is-notes">
          <UiCheckbox v-model:checked="bulkForm.updateNotes">备注</UiCheckbox>
          <UiInput
            v-model:value="bulkForm.notes"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            :disabled="!bulkForm.updateNotes"
            placeholder="留空将清除备注"
          />
        </div>
      </div>

      <template #footer>
        <UiSpace justify="end">
          <UiButton :disabled="bulkBusy" @click="showBulkEdit = false">取消</UiButton>
          <UiButton type="primary" :loading="bulkBusy" @click="submitBulkEdit">保存</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <ImportAccountsModal
      v-model:show="showBatchImport"
      @imported="handleBatchImported"
    />
  </div>
</template>

<style scoped>
.account-groups {
  display: grid;
  gap: 14px;
}

.bulk-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -8px -12px 16px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(37, 99, 235, 0.14);
  background: rgba(239, 246, 255, 0.85);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.bulk-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: #0f172a;
  font-size: 13px;
}

.bulk-summary strong {
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}

.bulk-selection-tools,
.bulk-buttons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.bulk-buttons {
  justify-content: flex-end;
}

.bulk-edit {
  display: grid;
  gap: 14px;
}

.bulk-edit-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(239, 246, 255, 0.82);
  color: rgba(15, 23, 42, 0.58);
  font-size: 13px;
}

.bulk-edit-note strong {
  color: #1d4ed8;
  font-weight: 800;
}

.bulk-edit-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.bulk-edit-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.bulk-edit-row.is-compact {
  grid-template-columns: 1fr;
  align-items: stretch;
  gap: 8px;
}

.bulk-edit-row.is-notes {
  align-items: flex-start;
}

.account-group-card {
  overflow: hidden;
  border-radius: 8px;
}

.account-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 10px;
}

.account-group-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.account-group-title strong {
  color: #1e293b;
  font-size: 15px;
  font-weight: 800;
}

.account-group-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
}

.account-group-meta span {
  display: flex;
  align-items: center;
  gap: 5px;
}

.account-group-meta span::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.account-group-meta span:nth-child(1)::before { background: #10b981; }
.account-group-meta span:nth-child(2)::before { background: #f59e0b; }
.account-group-meta span:nth-child(3)::before { background: #94a3b8; }

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

:deep(.sub2api-balance-remaining) {
  color: #18a058;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  white-space: nowrap;
}

:deep(.sub2api-balance-remaining.is-error) {
  color: #d03050;
}

:deep(.sub2api-balance-remaining.is-warning) {
  color: #d97706;
}

:deep(.sub2api-balance-remaining.is-default) {
  color: #64748b;
}

:deep(.sub2api-balance-detail) {
  overflow: hidden;
  color: rgba(15, 23, 42, 0.56);
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .sub2api-balance-detail {
  color: rgba(226, 232, 240, 0.62);
}

:deep(.quota-credits) {
  align-self: flex-start;
  margin-top: 1px;
  font-size: 11px;
}

:deep(.quota-row) {
  display: grid;
  grid-template-columns: 60px 50px 42px minmax(60px, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
}

:deep(.quota-label) {
  padding: 1.5px 6px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
}

:deep(.quota-label.is-5h) {
  color: #4338ca;
  background: rgba(224, 231, 255, 0.8);
}

:deep(.quota-label.is-7d) {
  color: #059669;
  background: rgba(209, 250, 229, 0.8);
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

:deep(.sub2api-balance-state) {
  color: rgba(15, 23, 42, 0.52);
  font-size: 12px;
}

:deep(.sub2api-balance-state.is-error),
:deep(.quota-refresh-error) {
  color: #d03050;
}

:deep(.quota-refresh-error) {
  max-width: 54px;
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .sub2api-balance-state {
  color: rgba(226, 232, 240, 0.62);
}

:global(.dark) .sub2api-balance-state.is-error,
:global(.dark) .quota-refresh-error {
  color: #f87171;
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
  display: block;
  width: 14px;
  height: 14px;
  transform-origin: center;
}

:deep(.quota-refresh-icon.is-spinning) {
  animation: quota-refresh-spin 0.7s linear infinite;
}

@keyframes quota-refresh-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

:deep(.priority-input) {
  width: 82px;
}

:deep(.concurrency-cell) {
  display: flex;
  align-items: center;
  gap: 6px;
}

:deep(.concurrency-input) {
  width: 74px;
}

:deep(.concurrency-now) {
  white-space: nowrap;
}

:deep(.autopause-input) {
  width: 88px;
}

:deep(.notes-input) {
  width: 150px;
  min-height: 30px;
  padding: 4px 8px;
  font-size: 12px;
}

:deep(.group-select) {
  min-width: 210px;
}

:deep(.account-table) {
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0;
}

:deep(.account-table .data-table th) {
  padding: 8px 12px;
}

:deep(.account-table .data-table td) {
  padding: 7px 12px;
}

.account-table-shell {
  border-radius: 8px;
}

.account-table-shell :deep(.account-table) {
  border-top: 0;
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
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  background: white;
  transition: all 0.2s ease;
}

.group-item:hover {
  border-color: rgba(37, 99, 235, 0.3);
  background: rgba(248, 250, 252, 0.8);
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.04);
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
:global(.dark) .account-group-title strong,
:global(.dark) .group-metric strong,
:global(.dark) .group-preview strong,
:global(.dark) .group-empty-card strong {
  color: #f8fafc;
}

:global(.dark) .account-group-meta {
  color: #94a3b8;
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

:global(.dark) .bulk-actions {
  border-color: rgba(59, 130, 246, 0.24);
  background: rgba(30, 41, 59, 0.82);
  color: rgba(226, 232, 240, 0.9);
}

:global(.dark) .bulk-edit-note {
  border-color: rgba(59, 130, 246, 0.2);
  background: rgba(30, 41, 59, 0.6);
  color: rgba(226, 232, 240, 0.6);
}

:global(.dark) .bulk-summary strong {
  color: #f8fafc;
}

:global(.dark) .bulk-edit-note strong {
  color: #93c5fd;
}

@media (max-width: 720px) {
  .bulk-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .bulk-buttons {
    justify-content: flex-start;
  }

  .bulk-edit-grid,
  .bulk-edit-row {
    grid-template-columns: 1fr;
  }

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
