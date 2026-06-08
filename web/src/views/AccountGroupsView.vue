<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
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

const providerLabel: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  xiaomi: 'Xiaomi MiMo',
}

const providerTagType: Record<string, 'info' | 'success' | 'warning' | 'default' | 'error'> = {
  claude: 'info',
  openai: 'success',
  gemini: 'warning',
  deepseek: 'error',
  xiaomi: 'warning',
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
const form = ref<{ name: string; description: string; rateMultiplier: number | null }>({
  name: '',
  description: '',
  rateMultiplier: 1,
})

const formTitle = computed(() => (editingId.value ? '编辑分组' : '新建分组'))

function openCreate() {
  editingId.value = null
  form.value = { name: '', description: '', rateMultiplier: 1 }
  showForm.value = true
}

function openEdit(group: GroupInfo) {
  editingId.value = group.id
  form.value = {
    name: group.name,
    description: group.description ?? '',
    rateMultiplier: group.rateMultiplier,
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
  saving.value = true
  try {
    if (editingId.value) {
      await api.patch(`/admin/account-groups/${editingId.value}`, {
        name: form.value.name.trim(),
        description: form.value.description.trim() || null,
        rateMultiplier: multiplier,
      })
      message.success('分组已更新')
    } else {
      await api.post('/admin/account-groups', {
        name: form.value.name.trim(),
        description: form.value.description.trim() || undefined,
        rateMultiplier: multiplier,
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
    render: (row) => h('span', { class: 'plain-cell' }, `${row.accountCount}`),
  },
  {
    title: '创建时间',
    key: 'createdAt',
    minWidth: 150,
    render: (row) => h('span', { class: 'plain-cell' }, formatTime(row.createdAt)),
  },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render: (row) =>
      h(UiSpace, { size: 4, wrap: false }, {
        default: () => [
          h(UiButton, { size: 'small', quaternary: true, onClick: () => openMembers(row) }, { default: () => '成员' }),
          h(UiButton, { size: 'small', quaternary: true, onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(UiButton, { size: 'small', type: 'error', quaternary: true, onClick: () => confirmDelete(row) }, { default: () => '删除' }),
        ],
      }),
  },
])

onMounted(() => {
  void load()
})
</script>

<template>
  <div>
    <div class="page-head">
      <UiButton type="primary" @click="openCreate">新建分组</UiButton>
    </div>

    <UiCard class="table-card" :bordered="false">
      <UiDataTable
        :columns="columns"
        :data="groups"
        :loading="loading"
        :bordered="false"
        :scroll-x="940"
      />
    </UiCard>

    <!-- create / edit -->
    <UiModal v-model:show="showForm" :title="formTitle" :width="480">
      <UiForm label-placement="top">
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
