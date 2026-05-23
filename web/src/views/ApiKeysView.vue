<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NSpace, NSwitch, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface ApiKey {
  id: string
  name: string
  ownerLabel: string | null
  keyPrefix: string
  enabled: boolean
  allowedProviders: string[] | null
  rateLimit: number | null
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
const form = ref({ name: '', ownerLabel: '', allowedProviders: [] as string[] })

/** Plaintext secret of a freshly created key — shown exactly once. */
const newKey = ref<string | null>(null)

// Edit-limits modal state.
const showEdit = ref(false)
const editing = ref(false)
const editId = ref<string | null>(null)
const editForm = ref<{
  name: string
  ownerLabel: string
  enabled: boolean
  allowedProviders: string[]
  rateLimit: number | null
  quotaLimit: number | null
  expiresAt: number | null
}>({
  name: '',
  ownerLabel: '',
  enabled: true,
  allowedProviders: [],
  rateLimit: null,
  quotaLimit: null,
  expiresAt: null,
})

const providerOptions = [
  { label: 'Claude', value: 'claude' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Gemini', value: 'gemini' },
]

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

async function create() {
  if (!form.value.name.trim()) {
    message.warning('请填写名称')
    return
  }
  creating.value = true
  try {
    const { data } = await api.post('/admin/keys', {
      name: form.value.name.trim(),
      ownerLabel: form.value.ownerLabel.trim() || undefined,
      allowedProviders: form.value.allowedProviders.length
        ? form.value.allowedProviders
        : undefined,
    })
    showCreate.value = false
    newKey.value = data.key
    form.value = { name: '', ownerLabel: '', allowedProviders: [] }
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
    rateLimit: row.rateLimit,
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
    await api.patch(`/admin/keys/${editId.value}`, {
      name: editForm.value.name.trim(),
      ownerLabel: editForm.value.ownerLabel.trim() || null,
      enabled: editForm.value.enabled,
      allowedProviders: editForm.value.allowedProviders.length
        ? editForm.value.allowedProviders
        : null,
      rateLimit: editForm.value.rateLimit,
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

function copyKey(text: string) {
  navigator.clipboard.writeText(text).then(
    () => message.success('已复制到剪贴板'),
    () => message.error('复制失败，请手动复制'),
  )
}

function closeNewKeyModal(shown: boolean) {
  if (!shown) newKey.value = null
}

function copyAndClose() {
  if (newKey.value) copyKey(newKey.value)
  newKey.value = null
}

function formatQuota(row: ApiKey): string {
  if (row.quotaLimit == null) return `$${row.quotaUsed.toFixed(4)} / 不限`
  return `$${row.quotaUsed.toFixed(4)} / $${row.quotaLimit.toFixed(2)}`
}

const columns = computed<DataTableColumns<ApiKey>>(() => [
  { title: '名称', key: 'name', minWidth: 120 },
  {
    title: '持有者',
    key: 'ownerLabel',
    render: (row) => row.ownerLabel || h('span', { style: 'opacity:0.35' }, '—'),
  },
  {
    title: 'Key 前缀',
    key: 'keyPrefix',
    render: (row) => h('code', null, `${row.keyPrefix}…`),
  },
  {
    title: '允许的服务商',
    key: 'allowedProviders',
    render: (row) => {
      const list = row.allowedProviders
      if (!list || list.length === 0) {
        return h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => '全部' })
      }
      return h(
        NSpace,
        { size: 4 },
        { default: () => list.map((p) => h(NTag, { size: 'small', bordered: false }, { default: () => p })) },
      )
    },
  },
  {
    title: '配额（已用 / 上限）',
    key: 'quota',
    render: (row) => formatQuota(row),
  },
  {
    title: '状态',
    key: 'enabled',
    render: (row) => h(NSwitch, { value: row.enabled, size: 'small', onUpdateValue: () => toggle(row) }),
  },
  { title: '最后使用', key: 'lastUsedAt', render: (row) => formatTime(row.lastUsedAt) },
  { title: '创建时间', key: 'createdAt', render: (row) => formatTime(row.createdAt) },
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

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">API Keys</h2>
        <div class="page-subtitle">签发、停用和限制调用方可访问的上游服务商。</div>
      </div>
      <n-button type="primary" @click="showCreate = true">新建 Key</n-button>
    </div>

    <n-card class="table-card" :bordered="false">
      <n-data-table :columns="columns" :data="keys" :loading="loading" :bordered="false" />
    </n-card>

    <!-- create -->
    <n-modal
      v-model:show="showCreate"
      preset="card"
      title="新建 API Key"
      style="width: 440px"
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
          <n-button type="primary" @click="copyAndClose">复制并关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- edit limits -->
    <n-modal v-model:show="showEdit" preset="card" title="编辑 API Key" style="width: 480px">
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
