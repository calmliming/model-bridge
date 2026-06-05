<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { NButton, NSpace, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { api, errMsg } from '../api/client'

interface Plan {
  id: string
  name: string
  description: string | null
  groupId: string
  groupName: string | null
  price: number
  dailyLimitUsd: number | null
  weeklyLimitUsd: number | null
  monthlyLimitUsd: number | null
  validityDays: number
  forSale: boolean
  sortOrder: number
}

interface GroupOption {
  id: string
  name: string
}

const message = useMessage()
const dialog = useDialog()
const loading = ref(false)
const plans = ref<Plan[]>([])
const groups = ref<GroupOption[]>([])
const groupOptions = computed(() => groups.value.map((g) => ({ label: g.name, value: g.id })))

const showEdit = ref(false)
const saving = ref(false)
const editing = ref<Plan | null>(null)
const form = ref({
  name: '',
  description: '',
  groupId: null as string | null,
  price: 0,
  dailyLimitUsd: null as number | null,
  weeklyLimitUsd: null as number | null,
  monthlyLimitUsd: null as number | null,
  validityDays: 30,
  forSale: false,
})

function formatUsd(value: number | null): string {
  return value == null ? '不限' : `$${value.toFixed(2)}`
}

async function load() {
  loading.value = true
  try {
    const [planRes, groupRes] = await Promise.all([
      api.get('/admin/subscription-plans'),
      api.get('/admin/account-groups'),
    ])
    plans.value = planRes.data.plans
    groups.value = groupRes.data.groups
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = {
    name: '', description: '', groupId: groups.value[0]?.id ?? null, price: 0,
    dailyLimitUsd: null, weeklyLimitUsd: null, monthlyLimitUsd: null, validityDays: 30, forSale: false,
  }
  showEdit.value = true
}

function openEdit(plan: Plan) {
  editing.value = plan
  form.value = {
    name: plan.name,
    description: plan.description ?? '',
    groupId: plan.groupId,
    price: plan.price,
    dailyLimitUsd: plan.dailyLimitUsd,
    weeklyLimitUsd: plan.weeklyLimitUsd,
    monthlyLimitUsd: plan.monthlyLimitUsd,
    validityDays: plan.validityDays,
    forSale: plan.forSale,
  }
  showEdit.value = true
}

async function save() {
  if (!form.value.name.trim()) {
    message.warning('请填写套餐名称')
    return
  }
  if (!form.value.groupId) {
    message.warning('请选择绑定的账号分组')
    return
  }
  saving.value = true
  const payload = {
    name: form.value.name.trim(),
    description: form.value.description.trim() || null,
    groupId: form.value.groupId,
    price: form.value.price,
    dailyLimitUsd: form.value.dailyLimitUsd,
    weeklyLimitUsd: form.value.weeklyLimitUsd,
    monthlyLimitUsd: form.value.monthlyLimitUsd,
    validityDays: form.value.validityDays,
    forSale: form.value.forSale,
  }
  try {
    if (editing.value) {
      await api.patch(`/admin/subscription-plans/${editing.value.id}`, payload)
    } else {
      await api.post('/admin/subscription-plans', payload)
    }
    showEdit.value = false
    message.success('已保存')
    await load()
  } catch (e) {
    message.error(errMsg(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(plan: Plan) {
  dialog.warning({
    title: '删除套餐',
    content: `确定删除套餐「${plan.name}」？已分配给用户的订阅不受影响。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.delete(`/admin/subscription-plans/${plan.id}`)
        message.success('已删除')
        await load()
      } catch (e) {
        message.error(errMsg(e, '删除失败'))
      }
    },
  })
}

// SUB_PLANS_COLUMNS_MARKER
const columns: DataTableColumns<Plan> = [
  { title: '名称', key: 'name', minWidth: 140, render: (row) => h('div', [h('strong', row.name), row.description ? h('div', { class: 'subtext' }, row.description) : null]) },
  { title: '分组', key: 'groupName', width: 120, render: (row) => row.groupName || '(已删除)' },
  { title: '售价', key: 'price', width: 90, render: (row) => (row.price > 0 ? `$${row.price.toFixed(2)}` : '免费') },
  { title: '日限额', key: 'dailyLimitUsd', width: 90, render: (row) => formatUsd(row.dailyLimitUsd) },
  { title: '周限额', key: 'weeklyLimitUsd', width: 90, render: (row) => formatUsd(row.weeklyLimitUsd) },
  { title: '月限额', key: 'monthlyLimitUsd', width: 90, render: (row) => formatUsd(row.monthlyLimitUsd) },
  { title: '有效期', key: 'validityDays', width: 90, render: (row) => `${row.validityDays} 天` },
  { title: '上架', key: 'forSale', width: 80, render: (row) => h(NTag, { size: 'small', type: row.forSale ? 'success' : 'default', bordered: false }, { default: () => (row.forSale ? '售卖中' : '未上架') }) },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, {
        default: () => [
          h(NButton, { size: 'small', quaternary: true, onClick: () => openEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', quaternary: true, onClick: () => confirmDelete(row) }, { default: () => '删除' }),
        ],
      }),
  },
]

onMounted(load)
</script>

<template>
  <div>
    <div class="toolbar">
      <n-button type="primary" @click="openCreate">新建套餐</n-button>
      <n-button secondary :loading="loading" @click="load">刷新</n-button>
    </div>
    <n-card class="table-card" :bordered="false">
      <n-data-table :columns="columns" :data="plans" :loading="loading" :bordered="false" :scroll-x="1000" />
    </n-card>

    <n-modal v-model:show="showEdit" :title="editing ? '编辑套餐' : '新建套餐'" :width="480">
      <n-form label-placement="top">
        <n-form-item label="套餐名称">
          <n-input v-model:value="form.name" placeholder="如：Claude 月卡" />
        </n-form-item>
        <n-form-item label="说明（可选）">
          <n-input v-model:value="form.description" placeholder="给用户看的套餐说明" />
        </n-form-item>
        <n-form-item label="绑定账号分组">
          <n-select v-model:value="form.groupId" :options="groupOptions" placeholder="订阅授予的调度分组" />
        </n-form-item>
        <n-grid :cols="2" :x-gap="12">
          <n-gi>
            <n-form-item label="售价（USD，0=免费）">
              <n-input-number v-model:value="form.price" :min="0" :precision="2" style="width: 100%" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="有效期（天）">
              <n-input-number v-model:value="form.validityDays" :min="1" :precision="0" style="width: 100%" />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-grid :cols="3" :x-gap="10">
          <n-gi>
            <n-form-item label="日限额">
              <n-input-number v-model:value="form.dailyLimitUsd" :min="0" placeholder="不限" style="width: 100%" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="周限额">
              <n-input-number v-model:value="form.weeklyLimitUsd" :min="0" placeholder="不限" style="width: 100%" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="月限额">
              <n-input-number v-model:value="form.monthlyLimitUsd" :min="0" placeholder="不限" style="width: 100%" />
            </n-form-item>
          </n-gi>
        </n-grid>
        <n-form-item>
          <n-checkbox v-model:checked="form.forSale">在用户套餐商店上架售卖</n-checkbox>
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEdit = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: 14px;
}

:deep(.subtext) {
  margin-top: 3px;
  color: rgba(15, 23, 42, 0.48);
  font-size: 12px;
}
</style>
