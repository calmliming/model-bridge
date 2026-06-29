<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { UiButton, UiSpace, UiSwitch, UiTag } from '../components/ui'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'
import {
  buildCcSwitchUrl,
  ccSwitchProviderName,
  launchCcSwitch,
  targetsForProviders,
  type CcSwitchTarget,
} from '../ccswitch'

interface ApiKey {
  id: string
  name: string
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
  rateMultiplier: number
}

const message = useMessage()
const dialog = useDialog()
const keys = ref<ApiKey[]>([])
const groups = ref<AccountGroup[]>([])
const loading = ref(true)

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
const newKey = ref<string | null>(null)
const newKeyProviders = ref<string[] | null>(null)

const baseOrigin = computed(() =>
  typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
)

// CC Switch one-click import modal state.
const showCcSwitch = ref(false)
const ccSwitchSecret = ref('')
const ccSwitchTargets = ref<CcSwitchTarget[]>([])

const showEdit = ref(false)
const editingId = ref<string | null>(null)
const editForm = ref({
  name: '',
  enabled: true,
  allowedProviders: [] as string[],
  allowedModels: [] as string[],
  modelMappings: [] as string[],
  accountGroupId: null as string | null,
  rateLimit: null as number | null,
  concurrencyLimit: null as number | null,
  quotaLimit: null as number | null,
  expiresAt: null as number | null,
})

const form = ref({
  name: '',
  allowedProviders: [] as string[],
  allowedModels: [] as string[],
  modelMappings: [] as string[],
  accountGroupId: null as string | null,
})

const providerOptions = [
  { label: 'Claude', value: 'claude' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Xiaomi MiMo', value: 'xiaomi' },
  { label: 'Zhipu GLM', value: 'zhipu' },
]

const providerLabel: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  xiaomi: 'Xiaomi MiMo',
  zhipu: 'Zhipu GLM',
}

const commonModelOptions = ['claude-*', 'gpt-*', 'gemini-*', 'deepseek-*', 'mimo-*', 'glm-*'].map((value) => ({ label: value, value }))
const commonMappingOptions = ['gpt-public=gpt-5.4', 'deepseek-pro=deepseek-v4-pro', 'mimo-pro=mimo-v2.5-pro', 'glm-pro=glm-5.2'].map((value) => ({ label: value, value }))

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
  return Object.entries(value ?? {}).map(([from, to]) => `${from}=${to}`)
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/users/keys')
    keys.value = data.keys
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

async function loadGroups() {
  try {
    const { data } = await api.get('/users/account-groups')
    groups.value = data.groups
  } catch {
    // 分组仅用于选择器，加载失败时静默忽略
  }
}

async function create() {
  if (!form.value.name.trim()) {
    message.warning('请填写名称')
    return
  }
  creating.value = true
  try {
    const { data } = await api.post('/users/keys', {
      name: form.value.name.trim(),
      allowedProviders: form.value.allowedProviders.length ? form.value.allowedProviders : undefined,
      allowedModels: form.value.allowedModels.length ? form.value.allowedModels : undefined,
      modelMappings: parseMappingEntries(form.value.modelMappings) ?? undefined,
      accountGroupId: form.value.accountGroupId ?? undefined,
    })
    newKey.value = data.key
    newKeyProviders.value = form.value.allowedProviders.length ? [...form.value.allowedProviders] : null
    showCreate.value = false
    form.value = { name: '', allowedProviders: [], allowedModels: [], modelMappings: [], accountGroupId: null }
    await load()
  } catch (e) {
    message.error(errMsg(e, '创建失败'))
  } finally {
    creating.value = false
  }
}

function openEdit(row: ApiKey) {
  editingId.value = row.id
  editForm.value = {
    name: row.name,
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
  if (!editingId.value) return
  await api.patch(`/users/keys/${editingId.value}`, {
    name: editForm.value.name.trim(),
    enabled: editForm.value.enabled,
    allowedProviders: editForm.value.allowedProviders.length ? editForm.value.allowedProviders : null,
    allowedModels: editForm.value.allowedModels.length ? editForm.value.allowedModels : null,
    modelMappings: parseMappingEntries(editForm.value.modelMappings),
    accountGroupId: editForm.value.accountGroupId,
    rateLimit: editForm.value.rateLimit,
    concurrencyLimit: editForm.value.concurrencyLimit,
    quotaLimit: editForm.value.quotaLimit,
    expiresAt: editForm.value.expiresAt,
  }).then(async () => {
    message.success('已保存')
    showEdit.value = false
    await load()
  }).catch((e) => message.error(errMsg(e, '保存失败')))
}

async function toggle(row: ApiKey) {
  try {
    await api.patch(`/users/keys/${row.id}`, { enabled: !row.enabled })
    await load()
  } catch (e) {
    message.error(errMsg(e))
  }
}

function confirmDelete(row: ApiKey) {
  dialog.warning({
    title: '删除 API Key',
    content: `确定删除「${row.name}」？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await api.delete(`/users/keys/${row.id}`)
      await load()
    },
  })
}

async function fetchSecret(row: ApiKey): Promise<string | null> {
  if (!row.canReveal) return null
  const { data } = await api.get(`/users/keys/${row.id}/secret`)
  return data.key
}

async function copyText(text: string) {
  await navigator.clipboard?.writeText(text)
  message.success('已复制')
}

async function copyKey(row: ApiKey) {
  try {
    const secret = await fetchSecret(row)
    if (!secret) {
      message.warning('无法再次显示完整 Key')
      return
    }
    await copyText(secret)
  } catch (e) {
    message.error(errMsg(e, '复制失败'))
  }
}

/** Opens the CC Switch import picker for an existing key, fetching its plaintext. */
async function openCcSwitch(row: ApiKey) {
  if (!row.canReveal) {
    message.warning('这个 Key 无法再次显示完整值，无法一键导入。请重新创建一个 Key。')
    return
  }
  try {
    const secret = await fetchSecret(row)
    if (!secret) {
      message.warning('无法获取完整 Key')
      return
    }
    ccSwitchSecret.value = secret
    ccSwitchTargets.value = targetsForProviders(row.allowedProviders)
    showCcSwitch.value = true
  } catch (e) {
    message.error(errMsg(e, '获取完整 Key 失败'))
  }
}

/** Opens the CC Switch import picker for a freshly created key (plaintext in hand). */
function openCcSwitchForNew() {
  if (!newKey.value) return
  ccSwitchSecret.value = newKey.value
  ccSwitchTargets.value = targetsForProviders(newKeyProviders.value)
  showCcSwitch.value = true
}

/** Builds the deep link for the chosen target and hands off to CC Switch. */
function triggerCcSwitch(target: CcSwitchTarget) {
  if (!ccSwitchSecret.value) return
  const url = buildCcSwitchUrl(target, {
    origin: baseOrigin.value,
    apiKey: ccSwitchSecret.value,
    name: ccSwitchProviderName(target),
  })
  launchCcSwitch(url)
  message.success('已唤起 CC Switch，请在弹出的应用中确认导入')
}

const columns = computed<TableColumn<ApiKey>[]>(() => [
  { title: '名称', key: 'name', minWidth: 150, render: (row) => h('strong', { class: 'key-name' }, row.name) },
  { title: '密钥', key: 'prefix', minWidth: 150, render: (row) => h('code', `${row.keyPrefix}...`) },
  { title: '服务商', key: 'providers', minWidth: 150, render: (row) => {
    const list = row.allowedProviders
    if (!list?.length) return h(UiTag, { size: 'small', type: 'success', bordered: false }, { default: () => '全部' })
    return h(UiSpace, { size: 4 }, { default: () => list.map((p) => h(UiTag, { size: 'small', bordered: false }, { default: () => providerLabel[p] ?? p })) })
  } },
  { title: '分组', key: 'group', minWidth: 110, render: (row) => row.accountGroupId
    ? h(UiTag, { size: 'small', type: 'info', bordered: false }, { default: () => groupName(row.accountGroupId) })
    : h(UiTag, { size: 'small', type: 'success', bordered: false }, { default: () => '默认池' }) },
  { title: '已用', key: 'quotaUsed', width: 100, render: (row) => formatUsd(row.quotaUsed) },
  { title: '上限', key: 'quotaLimit', width: 100, render: (row) => row.quotaLimit == null ? '不限' : formatUsd(row.quotaLimit) },
  { title: '限速', key: 'rateLimit', width: 90, render: (row) => row.rateLimit == null ? '不限' : `${row.rateLimit}/min` },
  { title: '并发', key: 'concurrencyLimit', width: 80, render: (row) => row.concurrencyLimit == null ? '不限' : row.concurrencyLimit },
  { title: '过期', key: 'expiresAt', minWidth: 140, render: (row) => formatTime(row.expiresAt) },
  { title: '最后使用', key: 'lastUsedAt', minWidth: 140, render: (row) => formatTime(row.lastUsedAt) },
  { title: '状态', key: 'enabled', width: 76, render: (row) => h(UiSwitch, { value: row.enabled, size: 'small', onUpdateValue: () => toggle(row) }) },
  { title: '操作', key: 'actions', width: 260, render: (row) => h(UiSpace, { size: 4, wrap: false }, { default: () => [
    h(UiButton, { size: 'small', quaternary: true, onClick: () => copyKey(row) }, { default: () => '复制' }),
    h(UiButton, { size: 'small', quaternary: true, disabled: !row.canReveal, onClick: () => openCcSwitch(row) }, { default: () => 'CC Switch' }),
    h(UiButton, { size: 'small', quaternary: true, onClick: () => openEdit(row) }, { default: () => '编辑' }),
    h(UiButton, { size: 'small', type: 'error', quaternary: true, onClick: () => confirmDelete(row) }, { default: () => '删除' }),
  ] }) },
])

onMounted(() => {
  void load()
  void loadGroups()
})
</script>

<template>
  <div>
    <div class="page-head">
      <UiButton type="primary" @click="showCreate = true">新建 Key</UiButton>
    </div>

    <UiCard class="table-card" :bordered="false">
      <UiDataTable :columns="columns" :data="keys" :loading="loading" :bordered="false" :scroll-x="1540" />
    </UiCard>

    <UiModal v-model:show="showCreate" title="新建 API Key" :width="520">
      <UiForm label-placement="top">
        <UiFormItem label="名称">
          <UiInput v-model:value="form.name" placeholder="例如：工作站" />
        </UiFormItem>
        <UiFormItem label="允许的服务商（留空 = 不限）">
          <UiSelect v-model:value="form.allowedProviders" multiple :options="providerOptions" placeholder="不限" />
        </UiFormItem>
        <UiFormItem label="允许的模型（留空 = 不限）">
          <UiSelect v-model:value="form.allowedModels" multiple filterable tag :options="commonModelOptions" placeholder="例如：gpt-*" />
        </UiFormItem>
        <UiFormItem label="模型映射">
          <UiSelect v-model:value="form.modelMappings" multiple filterable tag :options="commonMappingOptions" placeholder="客户端=上游" />
        </UiFormItem>
        <UiFormItem v-if="groups.length" label="账号分组（留空 = 默认池）">
          <UiSelect v-model:value="form.accountGroupId" clearable :options="groupSelectOptions" placeholder="默认池" />
        </UiFormItem>
      </UiForm>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showCreate = false">取消</UiButton>
          <UiButton type="primary" :loading="creating" @click="create">创建</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal :show="!!newKey" title="API Key 已创建" :width="520" @update:show="(shown: boolean) => { if (!shown) newKey = null }">
      <UiAlert type="warning" style="margin-bottom: 12px">请立即复制并妥善保存。</UiAlert>
      <UiInput :value="newKey ?? ''" readonly />
      <template #footer>
        <UiSpace justify="end">
          <UiButton secondary @click="openCcSwitchForNew">一键导入 CC Switch</UiButton>
          <UiButton type="primary" @click="copyText(newKey ?? '')">复制</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal v-model:show="showCcSwitch" title="一键导入 CC Switch" :width="460">
      <UiAlert type="info" style="margin-bottom: 14px">
        选择要导入的工具，浏览器会唤起本机的 CC Switch 应用并自动填入服务商地址与密钥。需先安装
        <a href="https://ccswitch.io" target="_blank" rel="noopener">CC Switch</a>。
      </UiAlert>
      <UiSpace vertical size="small" style="width: 100%">
        <UiButton
          v-for="target in ccSwitchTargets"
          :key="target.id"
          block
          secondary
          @click="triggerCcSwitch(target)"
        >
          {{ target.label }}
        </UiButton>
      </UiSpace>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showCcSwitch = false">关闭</UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <UiModal v-model:show="showEdit" title="编辑 API Key" :width="520">
      <UiForm label-placement="top">
        <UiFormItem label="名称">
          <UiInput v-model:value="editForm.name" />
        </UiFormItem>
        <UiFormItem label="允许的服务商">
          <UiSelect v-model:value="editForm.allowedProviders" multiple :options="providerOptions" placeholder="不限" />
        </UiFormItem>
        <UiFormItem label="允许的模型">
          <UiSelect v-model:value="editForm.allowedModels" multiple filterable tag :options="commonModelOptions" placeholder="不限" />
        </UiFormItem>
        <UiFormItem label="模型映射">
          <UiSelect v-model:value="editForm.modelMappings" multiple filterable tag :options="commonMappingOptions" placeholder="客户端=上游" />
        </UiFormItem>
        <UiFormItem v-if="groups.length" label="账号分组（留空 = 默认池）">
          <UiSelect v-model:value="editForm.accountGroupId" clearable :options="groupSelectOptions" placeholder="默认池" />
        </UiFormItem>
        <UiFormItem label="成本上限（USD）">
          <UiInputNumber v-model:value="editForm.quotaLimit" :min="0" :step="1" style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="速率上限（次/分钟）">
          <UiInputNumber v-model:value="editForm.rateLimit" :min="1" :step="10" style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="并发上限">
          <UiInputNumber v-model:value="editForm.concurrencyLimit" :min="1" :step="1" style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="过期时间">
          <UiDatePicker v-model:value="editForm.expiresAt" type="datetime" clearable style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="启用">
          <UiSwitch v-model:value="editForm.enabled" />
        </UiFormItem>
      </UiForm>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showEdit = false">取消</UiButton>
          <UiButton type="primary" @click="saveEdit">保存</UiButton>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
:deep(.key-name) {
  color: #0f172a;
}

code {
  color: #334155;
  font-size: 12px;
}
</style>
