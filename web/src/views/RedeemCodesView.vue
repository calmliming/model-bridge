<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import { UiButton, UiInputNumber, UiSpace, UiTag } from '../components/ui'
import { useDialog } from '../composables/useDialog'
import { useMessage } from '../composables/useMessage'
import type { TableColumn } from '../components/ui/types'
import { api, errMsg } from '../api/client'
import { formatTime } from '../utils'

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

// Generation form
const showGenerate = ref(false)
const generating = ref(false)
const genForm = ref({ count: 10, valueUsd: 5, validityDays: null as number | null, note: '' })

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

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/redeem-codes', { params: { pageSize: 100 } })
    codes.value = data.codes
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
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
  dialog.success({
    title: `批次 ${batchId} — ${list.length} 个兑换码`,
    content: () =>
      h('div', { style: 'max-height:50vh;overflow:auto' }, [
        h('p', { style: 'margin:0 0 8px;color:rgba(15,23,42,.6)' }, '请立即复制保存，明文仅在此展示。'),
        h(
          'textarea',
          {
            readonly: true,
            style:
              'width:100%;height:240px;font-family:monospace;font-size:13px;padding:10px;border-radius:8px;border:1px solid #e2e8f0',
            value: list.join('\n'),
          },
        ),
      ]),
    positiveText: '复制全部',
    onPositiveClick: () => {
      void navigator.clipboard?.writeText(list.join('\n'))
      message.success('已复制到剪贴板')
    },
  })
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
    <div class="toolbar">
      <UiButton type="primary" @click="showGenerate = true">生成兑换码</UiButton>
      <UiButton secondary :loading="loading" @click="load">刷新</UiButton>
    </div>
    <UiCard class="table-card" :bordered="false">
      <UiDataTable :columns="columns" :data="codes" :loading="loading" :bordered="false" :scroll-x="1180" />
    </UiCard>

    <UiModal v-model:show="showGenerate" title="生成兑换码" :width="460">
      <UiForm label-placement="top">
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
