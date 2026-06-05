<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  canReveal: boolean
  enabled: boolean
  allowedProviders: string[] | null
  allowedModels: string[] | null
  modelMappings: Record<string, string> | null
  rateLimit: number | null
  concurrencyLimit: number | null
  quotaLimit: number | null
  quotaUsed: number
  expiresAt: number | null
  lastUsedAt: number | null
  createdAt: number
}

const message = useMessage()
const dialog = useDialog()
const keys = ref<ApiKey[]>([])
const loading = ref(true)
const showCreate = ref(false)
const creating = ref(false)
const newKey = ref<string | null>(null)
const showEdit = ref(false)
const editingId = ref<string | null>(null)
const editForm = ref({
  name: '',
  enabled: true,
  allowedProviders: [] as string[],
  allowedModels: [] as string[],
  modelMappings: [] as string[],
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

const commonModelOptions = ['claude-*', 'gpt-*', 'gemini-*', 'deepseek-*'].map((value) => ({ label: value, value }))
const commonMappingOptions = ['gpt-public=gpt-5.4', 'deepseek-pro=deepseek-v4-pro'].map((value) => ({ label: value, value }))

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
    })
    newKey.value = data.key
    showCreate.value = false
    form.value = { name: '', allowedProviders: [], allowedModels: [], modelMappings: [] }
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

const columns = computed<DataTableColumns<ApiKey>>(() => [
  { title: '名称', key: 'name', minWidth: 150, render: (row) => h('strong', { class: 'key-name' }, row.name) },
  { title: '密钥', key: 'prefix', minWidth: 150, render: (row) => h('code', `${row.keyPrefix}...`) },
  { title: '服务商', key: 'providers', minWidth: 150, render: (row) => {
    const list = row.allowedProviders
    if (!list?.length) return h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '全部' })
    return h(NSpace, { size: 4 }, { default: () => list.map((p) => h(NTag, { size: 'small', bordered: false }, { default: () => providerLabel[p] ?? p })) })
  } },
  { title: '已用', key: 'quotaUsed', width: 100, render: (row) => formatUsd(row.quotaUsed) },
  { title: '上限', key: 'quotaLimit', width: 100, render: (row) => row.quotaLimit == null ? '不限' : formatUsd(row.quotaLimit) },
  { title: '限速', key: 'rateLimit', width: 90, render: (row) => row.rateLimit == null ? '不限' : `${row.rateLimit}/min` },
  { title: '并发', key: 'concurrencyLimit', width: 80, render: (row) => row.concurrencyLimit == null ? '不限' : row.concurrencyLimit },
  { title: '过期', key: 'expiresAt', minWidth: 140, render: (row) => formatTime(row.expiresAt) },
  { title: '最后使用', key: 'lastUsedAt', minWidth: 140, render: (row) => formatTime(row.lastUsedAt) },
  { title: '状态', key: 'enabled', width: 76, render: (row) => h(NSwitch, { value: row.enabled, size: 'small', onUpdateValue: () => toggle(row) }) },
  { title: '操作', key: 'actions', width: 160, render: (row) => h(NSpace, { size: 4, wrap: false }, { default: () => [
    h(NButton, { size: 'small', quaternary: true, onClick: () => copyKey(row) }, { default: () => '复制' }),
    h(NButton, { size: 'small', quaternary: true, onClick: () => openEdit(row) }, { default: () => '编辑' }),
    h(NButton, { size: 'small', type: 'error', quaternary: true, onClick: () => confirmDelete(row) }, { default: () => '删除' }),
  ] }) },
])

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <n-button type="primary" @click="showCreate = true">新建 Key</n-button>
    </div>

    <n-card class="table-card" :bordered="false">
      <n-data-table :columns="columns" :data="keys" :loading="loading" :bordered="false" :scroll-x="1320" />
    </n-card>

    <n-modal v-model:show="showCreate" title="新建 API Key" :width="520">
      <n-form label-placement="top">
        <n-form-item label="名称">
          <n-input v-model:value="form.name" placeholder="例如：工作站" />
        </n-form-item>
        <n-form-item label="允许的服务商（留空 = 不限）">
          <n-select v-model:value="form.allowedProviders" multiple :options="providerOptions" placeholder="不限" />
        </n-form-item>
        <n-form-item label="允许的模型（留空 = 不限）">
          <n-select v-model:value="form.allowedModels" multiple filterable tag :options="commonModelOptions" placeholder="例如：gpt-*" />
        </n-form-item>
        <n-form-item label="模型映射">
          <n-select v-model:value="form.modelMappings" multiple filterable tag :options="commonMappingOptions" placeholder="客户端=上游" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreate = false">取消</n-button>
          <n-button type="primary" :loading="creating" @click="create">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal :show="!!newKey" title="API Key 已创建" :width="520" @update:show="(shown: boolean) => { if (!shown) newKey = null }">
      <n-alert type="warning" style="margin-bottom: 12px">请立即复制并妥善保存。</n-alert>
      <n-input :value="newKey ?? ''" readonly />
      <template #footer>
        <n-space justify="end">
          <n-button type="primary" @click="copyText(newKey ?? '')">复制</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showEdit" title="编辑 API Key" :width="520">
      <n-form label-placement="top">
        <n-form-item label="名称">
          <n-input v-model:value="editForm.name" />
        </n-form-item>
        <n-form-item label="允许的服务商">
          <n-select v-model:value="editForm.allowedProviders" multiple :options="providerOptions" placeholder="不限" />
        </n-form-item>
        <n-form-item label="允许的模型">
          <n-select v-model:value="editForm.allowedModels" multiple filterable tag :options="commonModelOptions" placeholder="不限" />
        </n-form-item>
        <n-form-item label="模型映射">
          <n-select v-model:value="editForm.modelMappings" multiple filterable tag :options="commonMappingOptions" placeholder="客户端=上游" />
        </n-form-item>
        <n-form-item label="成本上限（USD）">
          <n-input-number v-model:value="editForm.quotaLimit" :min="0" :step="1" style="width: 100%" />
        </n-form-item>
        <n-form-item label="速率上限（次/分钟）">
          <n-input-number v-model:value="editForm.rateLimit" :min="1" :step="10" style="width: 100%" />
        </n-form-item>
        <n-form-item label="并发上限">
          <n-input-number v-model:value="editForm.concurrencyLimit" :min="1" :step="1" style="width: 100%" />
        </n-form-item>
        <n-form-item label="过期时间">
          <n-date-picker v-model:value="editForm.expiresAt" type="datetime" clearable style="width: 100%" />
        </n-form-item>
        <n-form-item label="启用">
          <n-switch v-model:value="editForm.enabled" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" @click="saveEdit">保存</n-button>
        </n-space>
      </template>
    </n-modal>
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
