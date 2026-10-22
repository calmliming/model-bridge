<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { UiButton, UiInputNumber, UiSpace, UiTag } from '../components/ui'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { formatTime, formatUsd } from '../utils'

interface RedeemCode {
  id: string
  code: string | null
  type: string
  value: number
  status: 'unused' | 'used' | 'disabled'
  batchId: string | null
  note: string | null
  redeemedBy: string | null
  redeemedAt: number | null
  expiresAt: number | null
  createdAt: number
}

const message = useMessage()
const dialog = useDialog()
const loading = ref(false)
const codes = ref<RedeemCode[]>([])
const page = ref(1), total = ref(0), pageSize = 20
const summary = ref({ value: 0, used: 0 })
const statusFilter = ref(''), batchFilter = ref(''), validityFilter = ref('')
const appliedFilters = ref<Record<string, string | undefined>>({})
let loadVersion = 0
const revealedBatch = ref<{ id: string; codes: string[] } | null>(null)

function applyFilters() {
  appliedFilters.value = { status: statusFilter.value || undefined, batchId: batchFilter.value.trim() || undefined, validity: validityFilter.value || undefined }
  if (page.value === 1) void load()
  else page.value = 1
}
function resetFilters() { statusFilter.value = ''; batchFilter.value = ''; validityFilter.value = ''; applyFilters() }
watch(page, load)

// Generation form
const showGenerate = ref(false)
const generating = ref(false)
const genForm = ref({ count: 10, valueUsd: 5, validityDays: null as number | null, note: '' })
const generationValue = computed(() => Math.max(0, genForm.value.count || 0) * Math.max(0, genForm.value.valueUsd || 0))
const generationExpiry = computed(() => genForm.value.validityDays ? formatTime(Date.now() + genForm.value.validityDays * 86_400_000) : '永久有效')

const statusType: Record<RedeemCode['status'], 'success' | 'warning' | 'error' | 'default'> = {
  unused: 'success',
  used: 'default',
  disabled: 'error',
}
const statusLabel: Record<RedeemCode['status'], string> = {
  unused: '未使用',
  used: '已使用',
  disabled: '已禁用',
}

async function load() {
  const version = ++loadVersion
  loading.value = true
  try {
    const { data } = await api.get('/admin/redeem-codes', { params: { ...appliedFilters.value, page: page.value, pageSize } })
    if (version !== loadVersion) return
    codes.value = data.codes
    total.value = data.total
    summary.value = data.summary ?? { value: 0, used: 0 }
    const lastPage = Math.max(1, Math.ceil(data.total / pageSize))
    if (page.value > lastPage) page.value = lastPage
  } catch (e) {
    if (version === loadVersion) message.error(errMsg(e))
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

async function submitGenerate() {
  if (!genForm.value.count || genForm.value.count < 1) {
    message.warning('请填写生成数量')
    return
  }
  if (!genForm.value.valueUsd || genForm.value.valueUsd <= 0) {
    message.warning('请填写有效面额')
    return
  }
  generating.value = true
  try {
    const expiresAt = genForm.value.validityDays
      ? Date.now() + genForm.value.validityDays * 86_400_000
      : null
    const { data } = await api.post('/admin/redeem-codes', {
      count: genForm.value.count,
      valueUsd: genForm.value.valueUsd,
      expiresAt,
      note: genForm.value.note.trim() || undefined,
    })
    showGenerate.value = false
    message.success(`已生成 ${data.codes.length} 个兑换码`)
    await load()
    revealBatch(data.batchId, data.codes)
  } catch (e) {
    message.error(errMsg(e, '生成失败'))
  } finally {
    generating.value = false
  }
}

function revealBatch(batchId: string, list: string[]) {
  revealedBatch.value = { id: batchId, codes: list }
}

async function copyBatch() {
  try { await navigator.clipboard.writeText(revealedBatch.value?.codes.join('\n') ?? ''); message.success('已复制全部兑换码') }
  catch { message.warning('复制失败，请在文本框中手动选中并复制') }
}

async function exportBatch(batchId: string) {
  try {
    const { data } = await api.get('/admin/redeem-codes/export', { params: { batchId } })
    revealBatch(
      batchId,
      (data.codes as RedeemCode[]).map((c) => c.code ?? '').filter(Boolean),
    )
  } catch (e) {
    message.error(errMsg(e, '导出失败'))
  }
}

async function toggleStatus(row: RedeemCode) {
  const next = row.status === 'disabled' ? 'unused' : 'disabled'
  try {
    await api.patch(`/admin/redeem-codes/${row.id}`, { status: next })
    message.success(next === 'disabled' ? '已禁用' : '已启用')
    await load()
  } catch (e) {
    message.error(errMsg(e, '操作失败'))
  }
}

function confirmDelete(row: RedeemCode) {
  dialog.warning({
    title: '删除兑换码',
    content: '确认删除该兑换码？仅未使用的码可删除。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await api.delete(`/admin/redeem-codes/${row.id}`)
        message.success('已删除')
        await load()
      } catch (e) {
        message.error(errMsg(e, '删除失败'))
      }
    },
  })
}

// REDEEM_VIEW_COLUMNS_MARKER
const columns: TableColumn<RedeemCode>[] = [
  { title: '时间', key: 'createdAt', minWidth: 145, render: (row) => formatTime(row.createdAt) },
  { title: '面额', key: 'value', width: 100, render: (row) => h('strong', { class: 'amount' }, formatUsd(row.value)) },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) => h(UiTag, { size: 'small', type: statusType[row.status], bordered: false }, { default: () => statusLabel[row.status] }),
  },
  { title: '批次', key: 'batchId', minWidth: 150, render: (row) => h('span', { class: 'mono' }, row.batchId || '—') },
  { title: '有效期', key: 'expiresAt', minWidth: 145, render: (row) => (row.expiresAt ? formatTime(row.expiresAt) : '永久') },
  { title: '兑换时间', key: 'redeemedAt', minWidth: 145, render: (row) => (row.redeemedAt ? formatTime(row.redeemedAt) : '—') },
  { title: '备注', key: 'note', minWidth: 120, render: (row) => row.note || '—' },
  {
    title: '操作',
    key: 'actions',
    width: 200,
    render: (row) =>
      h(UiSpace, { size: 4, wrap: false }, {
        default: () => [
          row.batchId
            ? h(UiButton, { size: 'small', quaternary: true, onClick: () => exportBatch(row.batchId!) }, { default: () => '导出批次' })
            : null,
          row.status !== 'used'
            ? h(UiButton, { size: 'small', quaternary: true, onClick: () => toggleStatus(row) }, { default: () => (row.status === 'disabled' ? '启用' : '禁用') })
            : null,
          row.status !== 'used'
            ? h(UiButton, { size: 'small', type: 'error', quaternary: true, onClick: () => confirmDelete(row) }, { default: () => '删除' })
            : null,
        ],
      }),
  },
]

onMounted(load)
</script>

<template>
  <div>
    <form class="redeem-filters" @submit.prevent="applyFilters">
      <label><span class="field-label">批次</span><UiInput v-model:value="batchFilter" placeholder="输入完整批次 ID" /></label>
      <label><span class="field-label">状态</span><select v-model="statusFilter" class="input" aria-label="兑换码状态"><option value="">全部状态</option><option v-for="(label, value) in statusLabel" :key="value" :value="value">{{ label }}</option></select></label>
      <label><span class="field-label">有效期</span><select v-model="validityFilter" class="input" aria-label="兑换码有效期"><option value="">全部有效期</option><option value="valid">未过期</option><option value="expired">已过期</option><option value="permanent">永久有效</option></select></label>
      <div class="flex flex-wrap gap-2"><UiButton native-type="submit" type="primary">查询</UiButton><UiButton @click="resetFilters">重置</UiButton></div>
    </form>
    <div class="toolbar">
      <UiButton type="primary" @click="showGenerate = true">生成兑换码</UiButton>
      <UiButton secondary :loading="loading" @click="load">刷新</UiButton>
    </div>
    <p class="mb-4 text-sm text-gray-500">符合条件：{{ total }} 个 · 已使用 {{ summary.used }} 个 · 总面额 {{ formatUsd(summary.value) }}</p>
    <UiCard class="table-card hidden md:block" :bordered="false">
      <UiDataTable :columns="columns" :data="codes" :loading="loading" :bordered="false" :scroll-x="1180" empty-text="暂无符合条件的兑换码" />
    </UiCard>
    <div class="grid gap-3 md:hidden">
      <p v-if="loading" role="status" class="py-8 text-center text-sm text-gray-500">正在加载兑换码…</p>
      <p v-else-if="!codes.length" class="card p-6 text-center text-sm text-gray-500">暂无符合条件的兑换码，可调整筛选或生成新批次。</p>
      <article v-for="row in codes" :key="row.id" class="card min-w-0 p-4"><div class="flex justify-between gap-2"><strong class="text-xl">{{ formatUsd(row.value) }}</strong><UiTag :type="statusType[row.status]">{{ statusLabel[row.status] }}</UiTag></div><p class="mt-3 break-all text-xs text-gray-500">批次：{{ row.batchId || '无批次' }}</p><p class="mt-2 text-sm">有效期：{{ row.expiresAt ? formatTime(row.expiresAt) : '永久' }}</p><p v-if="row.note" class="mt-2 break-words text-sm text-gray-500">{{ row.note }}</p><div class="mt-4 flex flex-wrap gap-2"><UiButton v-if="row.batchId" secondary size="small" @click="exportBatch(row.batchId)">导出批次</UiButton><UiButton v-if="row.status !== 'used'" secondary size="small" @click="toggleStatus(row)">{{ row.status === 'disabled' ? '启用' : '禁用' }}</UiButton><UiButton v-if="row.status !== 'used'" quaternary type="error" size="small" @click="confirmDelete(row)">删除</UiButton></div></article>
    </div>
    <UiPagination class="mt-4" v-model:page="page" :page-size="pageSize" :item-count="total" :disabled="loading" />

    <UiModal :show="!!revealedBatch" title="导出兑换码" :width="560" @update:show="(shown: boolean) => { if (!shown) revealedBatch = null }">
      <p class="mb-3 break-all text-sm text-gray-500">批次 {{ revealedBatch?.id }} · {{ revealedBatch?.codes.length }} 个。请妥善保存，也可之后通过“导出批次”再次获取。</p>
      <textarea class="input font-mono text-sm" aria-label="兑换码明文列表" rows="8" readonly :value="revealedBatch?.codes.join('\n')" />
      <template #footer><UiButton @click="revealedBatch = null">关闭</UiButton><UiButton type="primary" @click="copyBatch">复制全部</UiButton></template>
    </UiModal>

    <UiModal v-model:show="showGenerate" title="生成兑换码" :width="460">
      <UiForm label-placement="top" @submit="submitGenerate">
        <UiFormItem label="生成数量（1–1000）">
          <UiInputNumber v-model:value="genForm.count" :min="1" :max="1000" style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="单张面额（USD）">
          <UiInputNumber v-model:value="genForm.valueUsd" :min="0.01" :step="1" style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="有效天数（留空 = 永久）">
          <UiInputNumber v-model:value="genForm.validityDays" :min="1" placeholder="永久有效" style="width: 100%" />
        </UiFormItem>
        <UiFormItem label="备注（可选）">
          <UiInput v-model:value="genForm.note" placeholder="例如：双十一活动" />
        </UiFormItem>
        <div class="rounded-xl bg-primary-50 p-3 text-sm text-primary-800 dark:bg-primary-900/20 dark:text-primary-200"><p>{{ genForm.count || 0 }} 张 × {{ formatUsd(genForm.valueUsd || 0) }} = <strong>{{ formatUsd(generationValue) }}</strong></p><p class="mt-1">有效至：{{ generationExpiry }}</p></div>
      </UiForm>
      <template #footer>
        <UiSpace justify="end">
          <UiButton @click="showGenerate = false">取消</UiButton>
          <UiButton type="primary" :loading="generating" @click="submitGenerate">生成</UiButton>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.redeem-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: end; gap: 12px; margin-bottom: 16px; }
.redeem-filters > label { min-width: 0; }
@media (min-width: 1280px) { .redeem-filters { grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr)) auto; } }
.toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-bottom: 14px;
}

.amount {
  color: #16a34a;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
</style>
