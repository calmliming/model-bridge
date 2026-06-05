<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NSpace, NSwitch, NTag, NTooltip, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface ApiKey {
  id: string
  name: string
  ownerLabel: string | null
  keyPrefix: string
  canReveal: boolean
  enabled: boolean
  allowedProviders: string[] | null
  allowedModels: string[] | null
  modelMappings: Record<string, string> | null
  accountGroupId: string | null
  rateLimit: number | null
  concurrencyLimit: number | null
  quotaLimit: number | null
  quotaUsed: number
  expiresAt: number | null
  lastUsedAt: number | null
  createdAt: number
}

interface AccountGroup {
  id: string
  name: string
  description: string | null
  rateMultiplier: number
  accountCount: number
  createdAt: number
}

const message = useMessage()
const dialog = useDialog()

const keys = ref<ApiKey[]>([])
const loading = ref(true)
const groups = ref<AccountGroup[]>([])

const groupSelectOptions = computed(() =>
  groups.value.map((g) => ({
    label: g.rateMultiplier === 1 ? g.name : `${g.name} ×${g.rateMultiplier}`,
    value: g.id,
  })),
)

function groupName(id: string | null): string {
  if (!id) return '默认池'
  return groups.value.find((g) => g.id === id)?.name ?? '(已删除)'
}

const showCreate = ref(false)
const creating = ref(false)
const form = ref({
  name: '',
  ownerLabel: '',
  allowedProviders: [] as string[],
  allowedModels: [] as string[],
  modelMappings: [] as string[],
  accountGroupId: null as string | null,
})

/** Plaintext secret of a freshly created key — shown exactly once. */
const newKey = ref<string | null>(null)
const showUse = ref(false)
const useKeyName = ref('')
const useKeySecret = ref('')

const manualCopy = ref<{ name: string; text: string } | null>(null)

// Edit-limits modal state.
const showEdit = ref(false)
const editing = ref(false)
const editId = ref<string | null>(null)
const editForm = ref<{
  name: string
  ownerLabel: string
  enabled: boolean
  allowedProviders: string[]
  allowedModels: string[]
  modelMappings: string[]
  accountGroupId: string | null
  rateLimit: number | null
  concurrencyLimit: number | null
  quotaLimit: number | null
  expiresAt: number | null
}>({
  name: '',
  ownerLabel: '',
  enabled: true,
  allowedProviders: [],
  allowedModels: [],
  modelMappings: [],
  accountGroupId: null,
  rateLimit: null,
  concurrencyLimit: null,
  quotaLimit: null,
  expiresAt: null,
})

const providerOptions = [
  { label: 'Claude', value: 'claude' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'DeepSeek', value: 'deepseek' },
]

const providerLabel: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
}

const providerTagType: Record<string, 'info' | 'success' | 'warning' | 'default' | 'error'> = {
  claude: 'info',
  openai: 'success',
  gemini: 'warning',
  deepseek: 'error',
}

const commonModelOptions = [
  'claude-*',
  'gpt-*',
  'gemini-*',
  'deepseek-*',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
].map((value) => ({ label: value, value }))

const commonMappingOptions = [
  'gpt-public=gpt-5.4',
  'gpt-fast=gpt-5.4-mini',
  'deepseek-pro=deepseek-v4-pro',
  'deepseek-fast=deepseek-v4-flash',
].map((value) => ({ label: value, value }))

function parseMappingEntries(entries: string[]): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const entry of entries) {
    const index = entry.indexOf('=')
    if (index <= 0) continue
    const from = entry.slice(0, index).trim()
    const to = entry.slice(index + 1).trim()
    if (from && to) out[from] = to
  }
  return Object.keys(out).length ? out : null
}

function mappingEntriesFromObject(value: Record<string, string> | null): string[] {
  return Object.entries(value ?? {})
    .filter(([from, to]) => from.trim() && to.trim())
    .map(([from, to]) => `${from}=${to}`)
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/keys')
    keys.value = data.keys
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

async function loadGroups() {
  try {
    const { data } = await api.get('/admin/account-groups')
    groups.value = data.groups
  } catch {
    // 分组仅用于选择器的上下文，加载失败时静默忽略
  }
}

async function create() {
  if (!form.value.name.trim()) {
    message.warning('请填写名称')
    return
  }
  creating.value = true
  try {
    const modelMappings = parseMappingEntries(form.value.modelMappings)
    const { data } = await api.post('/admin/keys', {
      name: form.value.name.trim(),
      ownerLabel: form.value.ownerLabel.trim() || undefined,
      allowedProviders: form.value.allowedProviders.length
        ? form.value.allowedProviders
        : undefined,
      allowedModels: form.value.allowedModels.length
        ? form.value.allowedModels
        : undefined,
      modelMappings: modelMappings ?? undefined,
      accountGroupId: form.value.accountGroupId ?? undefined,
    })
    showCreate.value = false
    newKey.value = data.key
    form.value = {
      name: '',
      ownerLabel: '',
      allowedProviders: [],
      allowedModels: [],
      modelMappings: [],
      accountGroupId: null,
    }
    await load()
  } catch (e) {
    message.error(errMsg(e, '创建失败'))
  } finally {
    creating.value = false
  }
}

async function toggle(row: ApiKey) {
  try {
    await api.patch(`/admin/keys/${row.id}`, { enabled: !row.enabled })
    await load()
  } catch (e) {
    message.error(errMsg(e))
  }
}

function openEdit(row: ApiKey) {
  editId.value = row.id
  editForm.value = {
    name: row.name,
    ownerLabel: row.ownerLabel ?? '',
    enabled: row.enabled,
    allowedProviders: row.allowedProviders ?? [],
    allowedModels: row.allowedModels ?? [],
    modelMappings: mappingEntriesFromObject(row.modelMappings),
    accountGroupId: row.accountGroupId,
    rateLimit: row.rateLimit,
    concurrencyLimit: row.concurrencyLimit,
    quotaLimit: row.quotaLimit,
    expiresAt: row.expiresAt,
  }
  showEdit.value = true
}

async function saveEdit() {
  if (!editId.value) return
  if (!editForm.value.name.trim()) {
    message.warning('名称不能为空')
    return
  }
  editing.value = true
  try {
    const modelMappings = parseMappingEntries(editForm.value.modelMappings)
    await api.patch(`/admin/keys/${editId.value}`, {
      name: editForm.value.name.trim(),
      ownerLabel: editForm.value.ownerLabel.trim() || null,
      enabled: editForm.value.enabled,
      allowedProviders: editForm.value.allowedProviders.length
        ? editForm.value.allowedProviders
        : null,
      allowedModels: editForm.value.allowedModels.length
        ? editForm.value.allowedModels
        : null,
      modelMappings,
      accountGroupId: editForm.value.accountGroupId,
      rateLimit: editForm.value.rateLimit,
      concurrencyLimit: editForm.value.concurrencyLimit,
      quotaLimit: editForm.value.quotaLimit,
      expiresAt: editForm.value.expiresAt,
    })
    message.success('已保存')
    showEdit.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, '保存失败'))
  } finally {
    editing.value = false
  }
}

function confirmDelete(row: ApiKey) {
  dialog.warning({
    title: '删除 API Key',
    content: `确定删除「${row.name}」？此操作不可撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.delete(`/admin/keys/${row.id}`)
        message.success('已删除')
        await load()
      } catch (e) {
        message.error(errMsg(e))
      }
    },
  })
}

function execCopyFallback(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '0'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return false
  }
  return false
}

async function writeClipboard(text: string): Promise<boolean> {
  if (await writeClipboardText(text)) {
    message.success('已复制到剪贴板')
    return true
  }
  if (execCopyFallback(text)) {
    message.success('已复制到剪贴板')
    return true
  }
  message.error('复制失败，请手动复制')
  return false
}

function copyKey(text: string) {
  void writeClipboard(text)
}

function showManualCopy(name: string, text: string) {
  manualCopy.value = { name, text }
}

async function fetchFullKey(row: ApiKey): Promise<string | null> {
  if (!row.canReveal) {
    message.warning('这个 Key 创建时未保存密文，无法再次显示完整值。请重新创建一个 Key。')
    return null
  }
  try {
    const { data } = await api.get(`/admin/keys/${row.id}/secret`)
    return data.key
  } catch (e) {
    message.error(errMsg(e, '获取完整 Key 失败'))
    return null
  }
}

async function copyApiKey(row: ApiKey) {
  if (!row.canReveal) {
    message.warning('这个 Key 创建时未保存密文，无法再次显示完整值。请重新创建一个 Key。')
    return
  }
  // 在 secure context 下用 ClipboardItem 包装异步 Promise，
  // 这样浏览器认可的“用户手势”不会因 await 网络请求而失效。
  const canUseAsyncClipboard =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.ClipboardItem === 'function' &&
    !!navigator.clipboard?.write
  if (canUseAsyncClipboard) {
    try {
      const item = new ClipboardItem({
        'text/plain': fetchFullKey(row).then((key) => {
          if (!key) throw new Error('no key')
          return new Blob([key], { type: 'text/plain' })
        }),
      })
      await navigator.clipboard.write([item])
      message.success('已复制到剪贴板')
      return
    } catch {
      // 走下面的回退路径
    }
  }
  // 非 secure context 或 ClipboardItem 不可用：先取 key，再尝试同步 fallback；
  // fallback 失败则弹出手动复制框。
  const key = await fetchFullKey(row)
  if (!key) return
  if (execCopyFallback(key)) {
    message.success('已复制到剪贴板')
    return
  }
  showManualCopy(row.name, key)
}

function closeNewKeyModal(shown: boolean) {
  if (!shown) newKey.value = null
}

async function copyAndClose() {
  const key = newKey.value
  if (!key) return
  const ok = await writeClipboardText(key)
  if (ok) {
    message.success('已复制到剪贴板')
    newKey.value = null
    return
  }
  newKey.value = null
  showManualCopy('新建 API Key', key)
  message.warning('浏览器未允许自动复制，请手动复制下方内容')
}

async function openUse(row: ApiKey) {
  useKeyName.value = row.name
  useKeySecret.value = (await fetchFullKey(row)) ?? `${row.keyPrefix}...`
  showUse.value = true
}

function openUseNewKey() {
  if (!newKey.value) return
  useKeyName.value = '新建 API Key'
  useKeySecret.value = newKey.value
  showUse.value = true
}

const baseOrigin = computed(() => {
  if (typeof window === 'undefined') return 'http://localhost:3000'
  return window.location.origin
})

const snippets = computed(() => {
  const key = useKeySecret.value || 'mb-xxxxxxxx'
  return {
    claude: `export ANTHROPIC_BASE_URL=${baseOrigin.value}
export ANTHROPIC_AUTH_TOKEN=${key}
claude`,
    deepseek: `export ANTHROPIC_BASE_URL=${baseOrigin.value}/api/deepseek
export ANTHROPIC_AUTH_TOKEN=${key}
export ANTHROPIC_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
claude`,
    codex: `[profiles.model-bridge]
model_provider = "model-bridge"
model = "gpt-5.5"

[model_providers.model-bridge]
name = "model-bridge"
base_url = "${baseOrigin.value}/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false

export MODEL_BRIDGE_API_KEY=${key}
codex --profile model-bridge`,
    codexDeepseek: `[profiles.model-bridge-deepseek]
model_provider = "model-bridge-deepseek"
model = "deepseek-v4-pro"

[model_providers.model-bridge-deepseek]
name = "model-bridge-deepseek"
base_url = "${baseOrigin.value}/api/deepseek/v1"
env_key = "MODEL_BRIDGE_API_KEY"
wire_api = "responses"
requires_openai_auth = false

export MODEL_BRIDGE_API_KEY=${key}
codex --profile model-bridge-deepseek`,
    gemini: `Base URL: ${baseOrigin.value}
API Key:  ${key}`,
    openaiCompat: `Base URL: ${baseOrigin.value}/v1
API Key:  ${key}

# Chat Completions endpoint:
POST ${baseOrigin.value}/v1/chat/completions

# Model list:
GET ${baseOrigin.value}/v1/models`,
    deepseekOpenai: `Base URL: ${baseOrigin.value}/api/deepseek/v1
API Key:  ${key}

# Chat Completions endpoint:
POST ${baseOrigin.value}/api/deepseek/v1/chat/completions

# Model list:
GET ${baseOrigin.value}/api/deepseek/v1/models`,
  }
})

function quotaPercent(row: ApiKey): number {
  if (!row.quotaLimit || row.quotaLimit <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((row.quotaUsed / row.quotaLimit) * 100)))
}

function quotaStatus(row: ApiKey) {
  const percent = quotaPercent(row)
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'
  return 'success'
}

function formatRateLimit(row: ApiKey): string {
  return row.rateLimit == null ? '不限速' : `${row.rateLimit}/min`
}

function renderKeyInfo(row: ApiKey) {
  return h('div', { class: 'key-name' }, row.name)
}

function renderOwner(row: ApiKey) {
  return row.ownerLabel
    ? h('span', { class: 'plain-cell' }, row.ownerLabel)
    : h('span', { class: 'muted-cell' }, '—')
}

function renderKeyPrefix(row: ApiKey) {
  return h('div', { class: 'key-prefix-cell' }, [
      h('code', null, `${row.keyPrefix}…`),
      h(
        NButton,
        { size: 'tiny', quaternary: true, class: 'inline-action', onClick: () => copyApiKey(row) },
        { default: () => '复制' },
      ),
  ])
}

function renderProviders(row: ApiKey) {
  const list = row.allowedProviders
  if (!list || list.length === 0) {
    return h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '全部' })
  }
  return h(
    NSpace,
    { size: 4 },
    {
      default: () =>
        list.map((p) =>
          h(
            NTag,
            { size: 'small', type: providerTagType[p] ?? 'default', bordered: false },
            { default: () => providerLabel[p] ?? p },
          ),
        ),
    },
  )
}

function renderModels(row: ApiKey) {
  const list = row.allowedModels
  if (!list || list.length === 0) {
    return h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '全部' })
  }
  const visible = list.slice(0, 2)
  const tags = visible.map((model) =>
    h(NTag, { size: 'small', bordered: false }, { default: () => model }),
  )
  if (list.length > visible.length) {
    tags.push(
      h(
        NTooltip,
        null,
        {
          trigger: () => h(NTag, { size: 'small', bordered: false }, { default: () => `+${list.length - visible.length}` }),
          default: () => list.slice(visible.length).join(', '),
        },
      ),
    )
  }
  return h(NSpace, { size: 4 }, { default: () => tags })
}

function renderMappings(row: ApiKey) {
  const entries = Object.entries(row.modelMappings ?? {})
  if (entries.length === 0) {
    return h('span', { class: 'muted-cell' }, '—')
  }
  const visible = entries.slice(0, 1)
  const tags = visible.map(([from, to]) =>
    h(NTag, { size: 'small', bordered: false }, { default: () => `${from}→${to}` }),
  )
  if (entries.length > visible.length) {
    tags.push(
      h(NTooltip, null, {
        trigger: () => h(NTag, { size: 'small', bordered: false }, { default: () => `+${entries.length - visible.length}` }),
        default: () => entries.slice(visible.length).map(([from, to]) => `${from}→${to}`).join(', '),
      }),
    )
  }
  return h(NSpace, { size: 4 }, { default: () => tags })
}

function renderGroup(row: ApiKey) {
  return row.accountGroupId
    ? h(NTag, { size: 'small', type: 'info', bordered: false }, { default: () => groupName(row.accountGroupId) })
    : h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '默认池' })
}

// Fixed USD→CNY rate for DeepSeek cost tooltip.
const USD_TO_CNY = 7.28

function renderUsage(row: ApiKey) {
  const span = h('span', { class: ['usage-value', `is-${quotaStatus(row)}`] }, `$${row.quotaUsed.toFixed(4)}`)
  const hasDeepSeek = !row.allowedProviders || row.allowedProviders.includes('deepseek')
  if (!hasDeepSeek) return span
  const cny = (row.quotaUsed * USD_TO_CNY).toFixed(4)
  return h(NTooltip, null, {
    trigger: () => span,
    default: () => `≈ ¥${cny}`,
  })
}

function renderQuotaLimit(row: ApiKey) {
  return row.quotaLimit == null
    ? h('span', { class: 'muted-cell' }, '不限')
    : h('span', { class: 'plain-cell' }, `$${row.quotaLimit.toFixed(2)}`)
}

function renderRateLimit(row: ApiKey) {
  return h('span', { class: row.rateLimit == null ? 'muted-cell' : 'plain-cell' }, formatRateLimit(row))
}

function renderConcurrency(row: ApiKey) {
  return row.concurrencyLimit == null
    ? h('span', { class: 'muted-cell' }, '不限')
    : h('span', { class: 'plain-cell' }, `${row.concurrencyLimit}`)
}

function renderTime(value: number | null) {
  return value ? h('span', { class: 'plain-cell' }, formatTime(value)) : h('span', { class: 'muted-cell' }, '—')
}

const columns = computed<DataTableColumns<ApiKey>>(() => [
  { title: '名称', key: 'name', minWidth: 140, render: renderKeyInfo },
  { title: '持有者', key: 'ownerLabel', minWidth: 100, render: renderOwner },
  {
    title: '密钥',
    key: 'keyPrefix',
    minWidth: 150,
    render: renderKeyPrefix,
  },
  {
    title: '服务商',
    key: 'allowedProviders',
    minWidth: 120,
    render: renderProviders,
  },
  {
    title: '模型',
    key: 'allowedModels',
    minWidth: 140,
    render: renderModels,
  },
  {
    title: '映射',
    key: 'modelMappings',
    minWidth: 170,
    render: renderMappings,
  },
  {
    title: '账号分组',
    key: 'accountGroupId',
    minWidth: 110,
    render: renderGroup,
  },
  {
    title: '已用',
    key: 'quota',
    minWidth: 100,
    render: renderUsage,
  },
  { title: '上限', key: 'quotaLimit', minWidth: 88, render: renderQuotaLimit },
  { title: '限速', key: 'rateLimit', minWidth: 88, render: renderRateLimit },
  { title: '并发', key: 'concurrencyLimit', minWidth: 72, render: renderConcurrency },
  { title: '过期', key: 'expiresAt', minWidth: 140, render: (row) => renderTime(row.expiresAt) },
  { title: '最后使用', key: 'lastUsedAt', minWidth: 140, render: (row) => renderTime(row.lastUsedAt) },
  {
    title: '创建时间',
    key: 'createdAt',
    minWidth: 140,
    render: (row) => renderTime(row.createdAt),
  },
  {
    title: '状态',
    key: 'enabled',
    width: 76,
    render: (row) => h(NSwitch, { value: row.enabled, size: 'small', onUpdateValue: () => toggle(row) }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 172,
    render: (row) =>
      h(
        NSpace,
        { size: 4, wrap: false },
        {
          default: () => [
            h(
              NButton,
              { size: 'small', quaternary: true, onClick: () => openUse(row) },
              { default: () => '使用' },
            ),
            h(
              NButton,
              { size: 'small', quaternary: true, onClick: () => openEdit(row) },
              { default: () => '编辑' },
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
  void loadGroups()
})
</script>

<template>
  <div>
    <div class="page-head">
      <n-button type="primary" @click="showCreate = true">新建 Key</n-button>
    </div>

    <n-card class="table-card" :bordered="false">
      <n-data-table
        :columns="columns"
        :data="keys"
        :loading="loading"
        :bordered="false"
        :scroll-x="1880"
      />
    </n-card>

    <!-- create -->
    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="新建 API Key"
      style="width: 520px"
    >
      <n-form label-placement="top">
        <n-form-item label="名称">
          <n-input v-model:value="form.name" placeholder="例如：我的笔记本" />
        </n-form-item>
        <n-form-item label="持有者（可选）">
          <n-input v-model:value="form.ownerLabel" placeholder="例如：张三" />
        </n-form-item>
        <n-form-item label="允许的服务商（留空 = 不限）">
          <n-select
            v-model:value="form.allowedProviders"
            multiple
            :options="providerOptions"
            placeholder="不限"
          />
        </n-form-item>
        <n-form-item label="允许的模型（留空 = 不限）">
          <n-select
            v-model:value="form.allowedModels"
            multiple
            filterable
            tag
            :options="commonModelOptions"
            placeholder="例如：gpt-*、claude-sonnet-*"
          />
        </n-form-item>
        <n-form-item label="模型映射（客户端=上游，留空 = 不映射）">
          <n-select
            v-model:value="form.modelMappings"
            multiple
            filterable
            tag
            :options="commonMappingOptions"
            placeholder="例如：gpt-public=gpt-5.4"
          />
        </n-form-item>
        <n-form-item label="账号分组（留空 = 默认池）">
          <n-select
            v-model:value="form.accountGroupId"
            clearable
            :options="groupSelectOptions"
            placeholder="默认池（仅调度未分组账号）"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="create">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- new-key reveal -->
    <n-modal
      :show="!!newKey"
      preset="card"
      title="API Key 已创建"
      style="width: 480px"
      @update:show="closeNewKeyModal"
    >
      <n-alert type="warning" style="margin-bottom: 12px">
        请立即复制并妥善保存，此密钥只会显示这一次。
      </n-alert>
      <n-input :value="newKey ?? ''" readonly />
      <template #footer>
        <n-space justify="end">
          <n-button secondary @click="openUseNewKey">查看接入方式</n-button>
          <n-button type="primary" @click="copyAndClose">复制并关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      :show="!!manualCopy"
      preset="card"
      title="请手动复制"
      style="width: 480px"
      @update:show="(shown: boolean) => { if (!shown) manualCopy = null }"
    >
      <n-alert type="info" style="margin-bottom: 12px">
        当前页面不在安全上下文（HTTPS 或 localhost），浏览器禁止自动写入剪贴板。请手动选中下方内容复制。
      </n-alert>
      <n-input
        :value="manualCopy?.text ?? ''"
        type="textarea"
        readonly
        :autosize="{ minRows: 2, maxRows: 4 }"
      />
      <template #footer>
        <n-space justify="end">
          <n-button type="primary" @click="manualCopy = null">关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showUse" preset="card" :title="`使用 ${useKeyName}`" style="width: 680px">
      <n-tabs type="line" animated>
        <n-tab-pane name="claude" tab="Claude Code">
          <pre><code>{{ snippets.claude }}</code></pre>
          <n-button size="small" secondary @click="copyKey(snippets.claude)">复制</n-button>
        </n-tab-pane>
        <n-tab-pane name="deepseek" tab="DeepSeek (Claude Code)">
          <pre><code>{{ snippets.deepseek }}</code></pre>
          <n-button size="small" secondary @click="copyKey(snippets.deepseek)">复制</n-button>
        </n-tab-pane>
        <n-tab-pane name="codex" tab="Codex CLI">
          <pre><code>{{ snippets.codex }}</code></pre>
          <n-button size="small" secondary @click="copyKey(snippets.codex)">复制</n-button>
        </n-tab-pane>
        <n-tab-pane name="codex-deepseek" tab="Codex CLI (DeepSeek)">
          <pre><code>{{ snippets.codexDeepseek }}</code></pre>
          <n-button size="small" secondary @click="copyKey(snippets.codexDeepseek)">复制</n-button>
        </n-tab-pane>
        <n-tab-pane name="gemini" tab="Gemini / 自定义客户端">
          <pre><code>{{ snippets.gemini }}</code></pre>
          <n-button size="small" secondary @click="copyKey(snippets.gemini)">复制</n-button>
        </n-tab-pane>
        <n-tab-pane name="openai" tab="OpenAI 兼容">
          <pre><code>{{ snippets.openaiCompat }}</code></pre>
          <n-button size="small" secondary @click="copyKey(snippets.openaiCompat)">复制</n-button>
        </n-tab-pane>
        <n-tab-pane name="deepseek-openai" tab="DeepSeek (OpenAI)">
          <pre><code>{{ snippets.deepseekOpenai }}</code></pre>
          <n-button size="small" secondary @click="copyKey(snippets.deepseekOpenai)">复制</n-button>
        </n-tab-pane>
      </n-tabs>
      <n-alert v-if="useKeySecret.endsWith('...')" type="info" style="margin-top: 14px">
        已存在的 Key 只保存哈希，后台无法再次显示完整密钥。请把示例里的前缀替换为你保存的完整 Key。
      </n-alert>
    </n-modal>

    <!-- edit limits -->
    <n-modal v-model:show="showEdit" preset="card" title="编辑 API Key" style="width: 520px">
      <n-form label-placement="top">
        <n-form-item label="名称">
          <n-input v-model:value="editForm.name" />
        </n-form-item>
        <n-form-item label="持有者">
          <n-input v-model:value="editForm.ownerLabel" placeholder="可留空" />
        </n-form-item>
        <n-form-item label="允许的服务商（留空 = 不限）">
          <n-select
            v-model:value="editForm.allowedProviders"
            multiple
            :options="providerOptions"
            placeholder="不限"
          />
        </n-form-item>
        <n-form-item label="允许的模型（留空 = 不限）">
          <n-select
            v-model:value="editForm.allowedModels"
            multiple
            filterable
            tag
            :options="commonModelOptions"
            placeholder="例如：gpt-*、claude-sonnet-*"
          />
        </n-form-item>
        <n-form-item label="模型映射（客户端=上游，留空 = 不映射）">
          <n-select
            v-model:value="editForm.modelMappings"
            multiple
            filterable
            tag
            :options="commonMappingOptions"
            placeholder="例如：gpt-public=gpt-5.4"
          />
        </n-form-item>
        <n-form-item label="账号分组（留空 = 默认池）">
          <n-select
            v-model:value="editForm.accountGroupId"
            clearable
            :options="groupSelectOptions"
            placeholder="默认池（仅调度未分组账号）"
          />
        </n-form-item>
        <n-form-item label="成本上限（USD，留空 = 不限）">
          <n-input-number
            v-model:value="editForm.quotaLimit"
            :min="0"
            :step="1"
            placeholder="例如：10"
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item label="速率上限（次/分钟，留空 = 不限）">
          <n-input-number
            v-model:value="editForm.rateLimit"
            :min="1"
            :step="10"
            placeholder="例如：60"
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item label="并发上限（同时进行的请求数，留空 = 不限）">
          <n-input-number
            v-model:value="editForm.concurrencyLimit"
            :min="1"
            :step="1"
            placeholder="例如：5"
            style="width: 100%"
          />
        </n-form-item>
        <n-form-item label="过期时间（留空 = 永久）">
          <n-date-picker v-model:value="editForm.expiresAt" type="datetime" clearable style="width: 100%" />
        </n-form-item>
        <n-form-item label="启用">
          <n-switch v-model:value="editForm.enabled" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="editing" @click="saveEdit">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
pre {
  margin: 0 0 12px;
  overflow-x: auto;
  padding: 16px;
  border-radius: 14px;
  background: #0f172a;
}

pre code {
  padding: 0;
  color: #e2e8f0;
  background: transparent;
  font-size: 13px;
  line-height: 1.65;
}

:deep(.key-name) {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.plain-cell),
:deep(.muted-cell) {
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
}

:deep(.plain-cell) {
  color: #0f172a;
}

:deep(.muted-cell) {
  color: rgba(15, 23, 42, 0.52);
}

:deep(.key-prefix-cell) {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: rgba(15, 23, 42, 0.52);
  font-size: 12px;
  white-space: nowrap;
}

:deep(.inline-action) {
  flex: 0 0 auto;
  padding: 0 4px;
  font-size: 12px;
}

:deep(.usage-value) {
  color: #0f172a;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

:deep(.usage-value.is-success) {
  color: #18a058;
}

:deep(.usage-value.is-warning) {
  color: #f0a020;
}

:deep(.usage-value.is-error) {
  color: #d03050;
}

</style>
