<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { UiButton, UiSpace, UiTag } from '../components/ui'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

interface GroupInfo {
  id: string
  name: string
  description: string | null
  rateMultiplier: number
  allowedModels: string[] | null
  accountCount: number
  createdAt: number
}

interface Member {
  accountId: string
  name: string
  provider: string
  status: string
  weight: number
  overridden: boolean
  /** Local editable copy of the in-group weight. */
  draftWeight: number
}

interface AccountOption {
  id: string
  name: string
  provider: string
}

const message = useMessage()
const dialog = useDialog()

const groups = ref<GroupInfo[]>([])
const loading = ref(true)
const search = ref('')
const groupDetails = ref<GroupInfo | null>(null)
const relatedKeys = ref<Array<{ id: string; name: string; accountGroupId: string | null }> | null>(null)
const filteredGroups = computed(() => groups.value.filter(group => `${group.name} ${group.description ?? ''}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const keysForGroup = (id: string) => relatedKeys.value?.filter(key => key.accountGroupId === id) ?? []

const providerLabel: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity（反重力）',
  deepseek: 'DeepSeek',
  xiaomi: 'Xiaomi MiMo',
  zhipu: 'Zhipu GLM',
  qwen: 'Tongyi Qwen',
  kimi: 'Kimi (Moonshot)',
  minimax: 'MiniMax',
  grsai: 'GrsAI',
  sub2api: 'Sub2API',
}

const providerTagType: Record<string, 'info' | 'success' | 'warning' | 'default' | 'error'> = {
  claude: 'info',
  openai: 'success',
  gemini: 'warning',
  antigravity: 'info',
  deepseek: 'error',
  xiaomi: 'warning',
  zhipu: 'info',
  qwen: 'info',
  kimi: 'default',
  minimax: 'error',
  grsai: 'info',
  sub2api: 'success',
}

const statusLabel: Record<string, string> = {
  active: '可用',
  rate_limited: '限流',
  error: '异常',
  disabled: '停用',
}

const statusTagType: Record<string, 'info' | 'success' | 'warning' | 'default' | 'error'> = {
  active: 'success',
  rate_limited: 'warning',
  error: 'error',
  disabled: 'default',
}

function rateMultiplierType(value: number): 'info' | 'success' | 'warning' | 'default' {
  if (value < 1) return 'success'
  if (value > 1) return 'warning'
  return 'default'
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/account-groups')
    groups.value = data.groups
  } catch (e) {
    message.error(errMsg(e, '加载分组失败'))
  } finally {
    loading.value = false
  }
}

// ── Create / edit modal ──────────────────────────────────
const showForm = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{ name: string; description: string; rateMultiplier: number | null; modelRestriction: boolean; allowedModelsText: string }>({
  name: '',
  description: '',
  rateMultiplier: 1, modelRestriction: false, allowedModelsText: '',
})

const formTitle = computed(() => (editingId.value ? '编辑分组' : '新建分组'))

function openCreate() {
  editingId.value = null
  form.value = { name: '', description: '', rateMultiplier: 1, modelRestriction: false, allowedModelsText: '' }
  showForm.value = true
}

function openEdit(group: GroupInfo) {
  editingId.value = group.id
  form.value = {
    name: group.name,
    description: group.description ?? '',
    rateMultiplier: group.rateMultiplier,
    modelRestriction: group.allowedModels != null,
    allowedModelsText: (group.allowedModels ?? []).join('\n'),
  }
  showForm.value = true
}

async function submitForm() {
  if (!form.value.name.trim()) {
    message.warning('请填写分组名称')
    return
  }
  const multiplier = form.value.rateMultiplier
  if (multiplier == null || !Number.isFinite(multiplier) || multiplier <= 0) {
    message.warning('请填写有效倍率')
    return
  }
  const allowedModels = form.value.modelRestriction
    ? [...new Set(form.value.allowedModelsText.split(/[\n,，]/).map(x => x.trim()).filter(Boolean))] : null
  if (allowedModels && !allowedModels.length) {
    message.warning('启用模型限制后，至少填写一个允许的模型')
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      await api.patch(`/admin/account-groups/${editingId.value}`, {
        name: form.value.name.trim(),
        description: form.value.description.trim() || null,
        rateMultiplier: multiplier,
        allowedModels,
      })
      message.success('分组已更新')
    } else {
      await api.post('/admin/account-groups', {
        name: form.value.name.trim(),
        description: form.value.description.trim() || undefined,
        rateMultiplier: multiplier,
        allowedModels,
      })
      message.success('分组已创建')
    }
    showForm.value = false
    await load()
  } catch (e) {
    message.error(errMsg(e, editingId.value ? '保存分组失败' : '创建分组失败'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(group: GroupInfo) {
  dialog.warning({
    title: '删除分组',
    content: `确定删除分组「${group.name}」？组内成员将回到默认池，绑定该分组的 API Key 也会改为默认池。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.delete(`/admin/account-groups/${group.id}`)
        message.success('已删除')
        await load()
      } catch (e) {
        message.error(errMsg(e, '删除失败'))
      }
    },
  })
}

// ── Members modal ────────────────────────────────────────
const showMembers = ref(false)
const membersLoading = ref(false)
const activeGroup = ref<GroupInfo | null>(null)
const members = ref<Member[]>([])
const allAccounts = ref<AccountOption[]>([])
const addAccountId = ref<string | null>(null)
const adding = ref(false)

const membersTitle = computed(() =>
  activeGroup.value ? `成员管理 · ${activeGroup.value.name}` : '成员管理',
)

const addableOptions = computed(() => {
  const existing = new Set(members.value.map((m) => m.accountId))
  return allAccounts.value
    .filter((a) => !existing.has(a.id))
    .map((a) => ({
      label: `${a.name}（${providerLabel[a.provider] ?? a.provider}）`,
      value: a.id,
    }))
})

async function loadMembers(groupId: string) {
  membersLoading.value = true
  try {
    const { data } = await api.get(`/admin/account-groups/${groupId}/members`)
    members.value = (data.members as Omit<Member, 'draftWeight'>[]).map((m) => ({
      ...m,
      draftWeight: m.weight,
    }))
  } catch (e) {
    message.error(errMsg(e, '加载成员失败'))
  } finally {
    membersLoading.value = false
  }
}

async function loadAllAccounts() {
  try {
    const { data } = await api.get('/admin/accounts')
    allAccounts.value = (data.accounts as AccountOption[]).map((a) => ({
      id: a.id,
      name: a.name,
      provider: a.provider,
    }))
  } catch {
    // 仅用于“添加成员”选择器，失败时静默
  }
}

async function openMembers(group: GroupInfo) {
  activeGroup.value = group
  addAccountId.value = null
  members.value = []
  showMembers.value = true
  await Promise.all([loadMembers(group.id), loadAllAccounts()])
}

async function refreshAfterMemberChange() {
  if (!activeGroup.value) return
  await loadMembers(activeGroup.value.id)
  // 刷新主表里的成员计数
  await load()
  const updated = groups.value.find((g) => g.id === activeGroup.value?.id)
  if (updated) activeGroup.value = updated
}

async function addMember() {
  if (!activeGroup.value || !addAccountId.value) {
    message.warning('请选择要加入的账户')
    return
  }
  adding.value = true
  try {
    await api.post(`/admin/account-groups/${activeGroup.value.id}/members/add`, {
      accountId: addAccountId.value,
    })
    addAccountId.value = null
    message.success('已加入分组')
    await refreshAfterMemberChange()
  } catch (e) {
    message.error(errMsg(e, '加入失败'))
  } finally {
    adding.value = false
  }
}

async function applyWeight(member: Member) {
  if (!activeGroup.value) return
  const weight = Math.max(1, Math.min(100, Math.trunc(member.draftWeight)))
  try {
    await api.patch(`/admin/account-groups/${activeGroup.value.id}/members`, {
      accountId: member.accountId,
      weight,
    })
    message.success('权重已更新')
    await loadMembers(activeGroup.value.id)
  } catch (e) {
    message.error(errMsg(e, '更新权重失败'))
  }
}

async function clearWeight(member: Member) {
  if (!activeGroup.value) return
  try {
    await api.patch(`/admin/account-groups/${activeGroup.value.id}/members`, {
      accountId: member.accountId,
      weight: null,
    })
    message.success('已恢复继承账户权重')
    await loadMembers(activeGroup.value.id)
  } catch (e) {
    message.error(errMsg(e, '操作失败'))
  }
}

async function removeMember(member: Member) {
  if (!activeGroup.value) return
  const groupId = activeGroup.value.id
  try {
    await api.delete(`/admin/account-groups/${groupId}/members/${member.accountId}`)
    message.success('已移出分组')
    await refreshAfterMemberChange()
  } catch (e) {
    message.error(errMsg(e, '移除失败'))
  }
}

// ── Tables ───────────────────────────────────────────────
const columns = computed<TableColumn<GroupInfo>[]>(() => [
  {
    title: '分组名称',
    key: 'name',
    minWidth: 160,
    render: (row) => h('div', { class: 'group-name' }, row.name),
  },
  {
    title: '描述',
    key: 'description',
    minWidth: 220,
    render: (row) =>
      row.description
        ? h('span', { class: 'plain-cell' }, row.description)
        : h('span', { class: 'muted-cell' }, '—'),
  },
  {
    title: '计费倍率',
    key: 'rateMultiplier',
    minWidth: 100,
    render: (row) =>
      h(
        UiTag,
        { size: 'small', type: rateMultiplierType(row.rateMultiplier), bordered: false },
        { default: () => `×${row.rateMultiplier}` },
      ),
  },
  {
    title: '成员数',
    key: 'accountCount',
    minWidth: 90,
    render: (row) => row.accountCount ? h('span', { class: 'plain-cell' }, `${row.accountCount}`)
      : h(UiTag, { type: 'warning' }, { default: () => '待添加账号' }),
  },
  { title: '关联 Key', key: 'keyCount', width: 100, render: row => relatedKeys.value == null ? '—' : keysForGroup(row.id).length },
  {
    title: '创建时间',
    key: 'createdAt',
    minWidth: 150,
    render: (row) => h('span', { class: 'plain-cell' }, formatTime(row.createdAt)),
  },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    fixed: 'right',
    render: (row) =>
      h(UiSpace, { size: 4, wrap: false }, {
        default: () => [
          h(UiButton, { size: 'small', quaternary: true, onClick: () => openMembers(row) }, { default: () => '成员' }),
          h(UiButton, { size: 'small', secondary: true, onClick: () => { groupDetails.value = row } }, { default: () => '详情' }),
        ],
      }),
  },
])
const visibleColumns = computed(() => ['name', 'accountCount', 'rateMultiplier', 'keyCount', 'actions'].flatMap(key => columns.value.filter(column => column.key === key)))
function manageGroup(action: 'members' | 'edit' | 'delete') {
  const group = groupDetails.value
  if (!group) return
  groupDetails.value = null
  if (action === 'members') void openMembers(group)
  else if (action === 'edit') openEdit(group)
  else confirmDelete(group)
}

onMounted(() => {
  void load()
  void api.get('/admin/keys').then(({ data }) => { relatedKeys.value = data.keys }).catch(() => {})
})
</script>

<template>
  <div>
    <div class="page-head">
      <UiInput v-model:value="search" aria-label="搜索分组" placeholder="搜索分组名称或描述" class="!w-full sm:!w-72" />
      <UiButton type="primary" @click="openCreate">新建分组</UiButton>
    </div>

    <UiCard class="table-card hidden md:block" :bordered="false">
      <UiDataTable
        :columns="visibleColumns"
        :data="filteredGroups"
        :loading="loading"
        :bordered="false"
        :scroll-x="640"
        empty-text="暂无符合条件的分组"
      />
    </UiCard>
    <div class="grid gap-3 md:hidden">
      <p v-if="loading" role="status" class="py-8 text-center text-sm text-gray-500">正在加载分组…</p>
      <p v-else-if="!filteredGroups.length" class="card p-6 text-center text-sm text-gray-500">暂无符合条件的分组</p>
      <article v-for="group in filteredGroups" :key="group.id" class="card min-w-0 p-4"><div class="flex justify-between gap-3"><h2 class="min-w-0 break-words font-semibold">{{ group.name }}</h2><UiTag :type="rateMultiplierType(group.rateMultiplier)">×{{ group.rateMultiplier }}</UiTag></div><p class="mt-3 text-sm text-gray-500">{{ group.accountCount }} 个账号 · 关联 {{ relatedKeys == null ? '—' : keysForGroup(group.id).length }} 个 Key</p><p v-if="!group.accountCount" class="mt-2 text-sm text-amber-700">尚未配置上游账号，当前分组无法调度。</p><div class="mt-4 flex gap-2"><UiButton size="small" :type="group.accountCount ? 'default' : 'primary'" @click="openMembers(group)">{{ group.accountCount ? '管理成员' : '添加成员' }}</UiButton><UiButton size="small" secondary @click="groupDetails = group">分组详情</UiButton></div></article>
    </div>
    <UiModal :show="!!groupDetails" :title="groupDetails?.name || '分组详情'" :width="520" @update:show="(shown: boolean) => { if (!shown) groupDetails = null }">
      <template v-if="groupDetails"><p class="text-sm text-gray-500">{{ groupDetails.description || '暂无分组说明' }}</p><dl class="my-4 grid grid-cols-2 gap-3 text-sm"><div><dt class="text-gray-500">计费倍率</dt><dd>×{{ groupDetails.rateMultiplier }}</dd></div><div><dt class="text-gray-500">创建时间</dt><dd>{{ formatTime(groupDetails.createdAt) }}</dd></div></dl><h3 class="text-sm font-semibold">关联 API Key</h3><p class="mt-2 break-words text-sm text-gray-500">{{ relatedKeys == null ? '关联信息暂时无法加载' : keysForGroup(groupDetails.id).map(key => key.name).join('、') || '暂无绑定的 Key' }}</p><RouterLink to="/keys" class="mt-3 inline-block text-sm text-primary-700" @click="groupDetails = null">前往 API Keys →</RouterLink></template>
      <template #footer><UiButton secondary @click="manageGroup('members')">管理成员</UiButton><UiButton secondary @click="manageGroup('edit')">编辑分组</UiButton><UiButton quaternary type="error" @click="manageGroup('delete')">删除</UiButton></template>
    </UiModal>

    <!-- create / edit -->
    <UiModal v-model:show="showForm" :title="formTitle" :width="480">
      <UiForm label-placement="top" @submit="submitForm">
        <UiFormItem label="分组名称">
          <UiInput v-model:value="form.name" placeholder="例如：高优先级池" />
        </UiFormItem>
        <UiFormItem label="描述（可选）">
          <UiInput
            v-model:value="form.description"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            placeholder="用于备注分组用途"
          />
        </UiFormItem>
        <UiFormItem label="限制可调用模型" hint="同时限制模型列表和实际请求。按客户端填写的模型名匹配，支持 * 通配符。">
          <UiSwitch v-model:value="form.modelRestriction" />
        </UiFormItem>
        <UiFormItem v-if="form.modelRestriction" label="允许的模型" hint="每行一个或用逗号分隔；模型映射的来源名称也须在此允许。">
          <UiInput v-model:value="form.allowedModelsText" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="MiniMax-*&#10;claude-sonnet-*" />
        </UiFormItem>
        <UiFormItem label="计费倍率（1 = 原价，<1 折扣，>1 溢价）">
          <UiInputNumber
            v-model:value="form.rateMultiplier"
            :min="0.01"
            :step="0.1"
            placeholder="例如：1"
            style="width: 100%"
          />
        </UiFormItem>
      </UiForm>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showForm = false">取消</UiButton>
          <UiButton type="primary" :loading="saving" @click="submitForm">
            {{ editingId ? '保存' : '创建' }}
          </UiButton>
        </UiSpace>
      </template>
    </UiModal>

    <!-- members -->
    <UiModal v-model:show="showMembers" :title="membersTitle" :width="720">
      <div class="member-add">
        <UiSelect
          v-model:value="addAccountId"
          filterable
          clearable
          class="member-add-select"
          :options="addableOptions"
          placeholder="选择账户加入该分组"
        />
        <UiButton type="primary" :loading="adding" :disabled="!addAccountId" @click="addMember">
          加入
        </UiButton>
      </div>

      <UiSpin :show="membersLoading">
        <div v-if="members.length === 0" class="member-empty">
          该分组暂无成员，先从上方添加账户。
        </div>
        <table v-else class="member-table">
          <thead>
            <tr>
              <th>账户</th>
              <th>服务商</th>
              <th>状态</th>
              <th>组内权重</th>
              <th class="member-actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in members" :key="m.accountId">
              <td>
                <span class="group-name">{{ m.name }}</span>
              </td>
              <td>
                <UiTag size="small" :type="providerTagType[m.provider] ?? 'default'" :bordered="false">
                  {{ providerLabel[m.provider] ?? m.provider }}
                </UiTag>
              </td>
              <td>
                <UiTag size="small" :type="statusTagType[m.status] ?? 'default'" :bordered="false">
                  {{ statusLabel[m.status] ?? m.status }}
                </UiTag>
              </td>
              <td>
                <div class="weight-cell">
                  <UiInputNumber
                    v-model:value="m.draftWeight"
                    size="small"
                    :min="1"
                    :max="100"
                    :step="1"
                    style="width: 92px"
                  />
                  <UiTag v-if="m.overridden" size="small" type="info" :bordered="false">覆盖</UiTag>
                  <UiTag v-else size="small" :bordered="false">继承</UiTag>
                </div>
              </td>
              <td>
                <UiSpace :size="4" :wrap="false">
                  <UiButton size="tiny" quaternary @click="applyWeight(m)">应用</UiButton>
                  <UiButton size="tiny" quaternary :disabled="!m.overridden" @click="clearWeight(m)">
                    继承
                  </UiButton>
                  <UiButton size="tiny" type="error" quaternary @click="removeMember(m)">移除</UiButton>
                </UiSpace>
              </td>
            </tr>
          </tbody>
        </table>
      </UiSpin>

      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showMembers = false">关闭</UiButton>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
:deep(.group-name) {
  overflow: hidden;
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.plain-cell) {
  color: #0f172a;
  font-size: 12px;
  white-space: nowrap;
}

:deep(.muted-cell) {
  color: rgba(15, 23, 42, 0.52);
  font-size: 12px;
}

.member-add {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.member-add-select {
  flex: 1 1 auto;
}

.member-empty {
  padding: 28px 0;
  color: rgba(15, 23, 42, 0.52);
  font-size: 13px;
  text-align: center;
}

.member-table {
  width: 100%;
  border-collapse: collapse;
}

.member-table th,
.member-table td {
  padding: 9px 10px;
  text-align: left;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  font-size: 13px;
  vertical-align: middle;
}

.member-table th {
  color: rgba(15, 23, 42, 0.55);
  font-size: 12px;
  font-weight: 600;
}

.member-actions-col {
  width: 200px;
}

.weight-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
