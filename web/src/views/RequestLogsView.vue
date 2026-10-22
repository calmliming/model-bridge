<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api, errMsg } from '../api/client'
import { calendarDayRangeMs, formatTime, formatUsd } from '../utils'
import { formatSubscriptionUsage } from '../billing'
import { logStatusLabel, logUsageLabel, safeResultUrl, type RequestLog, type RequestLogsPage } from '../requestLogs'
import { useMessage } from '../composables/useMessage'

const route = useRoute()
const message = useMessage()
const isAdmin = computed(() => route.meta.role === 'admin')
const endpoint = computed(() => isAdmin.value ? '/admin/logs' : '/users/logs')
const rows = ref<RequestLog[]>([])
const manufacturers = ref<RequestLogsPage['manufacturers']>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const error = ref('')
const autoRefresh = ref(true)
const lastUpdated = ref<number | null>(null)
const manufacturer = ref<string | null>(null)
const kind = ref<string | null>(null)
const status = ref<string | null>(null)
const model = ref('')
const key = ref('')
const dateFrom = ref('')
const dateEnd = ref('')
const advanced = ref(false)
const requestId = ref('')
const userFilter = ref('')
const accountFilter = ref('')
const selected = ref<RequestLog | null>(null)
const appliedFilters = ref<Record<string, unknown>>({})
let controller: AbortController | null = null
let version = 0
let pending = false
let timer: ReturnType<typeof setInterval> | undefined

const kindOptions = [{ value: 'text', label: '对话' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }]
const statusOptions = [{ value: 'running', label: '生成中（含提交中）' }, { value: 'settling', label: '结算中' }, { value: 'success', label: '成功' }, { value: 'error', label: '失败' }]
const kindLabel = (value: string) => kindOptions.find(item => item.value === value)?.label ?? value
const manufacturerLabel = (value: string) => manufacturers.value.find(item => item.value === value)?.label ?? '未知厂家'
const resultLinks = computed(() => (selected.value?.results ?? []).flatMap(result => {
  const url = safeResultUrl(result.url)
  return url ? [url] : []
}))

async function load(quiet = false) {
  const currentVersion = ++version
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  pending = true
  if (!quiet) loading.value = true
  const params: Record<string, unknown> = { ...appliedFilters.value, page: page.value, pageSize }
  try {
    const { data } = await api.get<RequestLogsPage>(endpoint.value, { params, signal })
    if (currentVersion !== version) return
    rows.value = data.logs
    manufacturers.value = data.manufacturers
    total.value = data.total
    error.value = ''
    lastUpdated.value = Date.now()
    if (selected.value) {
      const selectedId = selected.value.id
      const visible = data.logs.find(row => row.id === selectedId)
      if (visible) selected.value = visible
      else {
        // A completed task drops out of a "generating" filter. Keep its open
        // detail current instead of leaving the modal stuck in the old state.
        const detail = await api.get<RequestLogsPage>(endpoint.value, { params: { id: selectedId, pageSize: 1 }, signal })
        if (currentVersion === version && selected.value?.id === selectedId) selected.value = detail.data.logs[0] ?? null
      }
    }
    const maxPage = Math.max(1, Math.ceil(data.total / pageSize))
    if (page.value > maxPage) page.value = maxPage
  } catch (e) {
    if (!signal.aborted && currentVersion === version) error.value = errMsg(e, '日志加载失败')
  } finally {
    if (currentVersion === version) { loading.value = false; pending = false }
  }
}

function applyFilters() {
  if (dateFrom.value && dateEnd.value && dateFrom.value > dateEnd.value) { message.warning('开始日期不能晚于结束日期'); return }
  const params: Record<string, unknown> = {}
  if (requestId.value.trim()) params.id = requestId.value.trim()
  if (isAdmin.value && userFilter.value.trim()) params.user = userFilter.value.trim()
  if (isAdmin.value && accountFilter.value.trim()) params.account = accountFilter.value.trim()
  if (manufacturer.value) params.manufacturer = manufacturer.value
  if (kind.value) params.kind = kind.value
  if (status.value) params.status = status.value
  if (model.value.trim()) params.model = model.value.trim()
  if (key.value.trim()) params.key = key.value.trim()
  if (dateFrom.value) params.startDate = calendarDayRangeMs(dateFrom.value)[0]
  if (dateEnd.value) params.endDate = calendarDayRangeMs(dateEnd.value)[1]
  appliedFilters.value = params
  if (page.value === 1) void load()
  else page.value = 1
}

function resetFilters() {
  manufacturer.value = null; kind.value = null; status.value = null
  model.value = ''; key.value = ''; dateFrom.value = ''; dateEnd.value = ''
  requestId.value = ''; userFilter.value = ''; accountFilter.value = ''
  applyFilters()
}

function costLabel(row: RequestLog) {
  if (row.subscriptionPoints != null) return formatSubscriptionUsage(row.subscriptionPoints)
  return row.cost == null ? (row.status === 'error' ? '—' : '未结算') : formatUsd(row.cost)
}

function durationLabel(row: RequestLog) {
  return `${(row.latencyMs / 1000).toFixed(1)} 秒`
}

function errorSummary(row: RequestLog) {
  if (row.status !== 'error') return ''
  if (row.errorCode === 'no_available_account') return '暂无可用渠道，请稍后重试'
  if (row.errorCode === 'request_interrupted') return '生成中断，请重新发起'
  if (/rate|quota/.test(row.errorCode || '')) return '调用达到限额，请稍后重试'
  if (/violation|policy/.test(row.errorCode || '')) return '请求被拒绝，请查看详情'
  return '调用失败，请查看详情'
}

async function copyRequestId() {
  if (!selected.value) return
  try { await navigator.clipboard.writeText(selected.value.id); message.success('请求 ID 已复制') }
  catch { message.warning('复制失败，请手动复制请求 ID') }
}

watch(page, () => void load())
watch(endpoint, () => { selected.value = null; rows.value = []; applyFilters() })
onMounted(() => {
  void load()
  timer = setInterval(() => {
    if (autoRefresh.value && !pending && document.visibilityState === 'visible') void load(true)
  }, 5_000)
})
onBeforeUnmount(() => { ++version; controller?.abort(); clearInterval(timer) })
</script>

<template>
  <div class="logs-page">
    <UiCard :bordered="false" class="surface-card">
      <div class="logs-heading">
        <div>
          <p>查看调用结果与生成进度</p>
        </div>
        <div class="logs-actions">
          <label class="refresh-toggle"><input v-model="autoRefresh" type="checkbox" />自动刷新 · 5 秒</label>
          <UiButton size="small" :loading="loading" @click="load()">刷新</UiButton>
        </div>
      </div>
      <form class="logs-filters" @submit.prevent="applyFilters">
        <label><span>模型</span><UiInput v-model:value="model" placeholder="模型名称或调用别名" /></label>
        <label><span>状态</span><UiSelect v-model:value="status" :options="statusOptions" clearable aria-label="调用状态" placeholder="全部状态" /></label>
        <div class="filter-actions"><UiButton type="primary" native-type="submit">查询</UiButton><UiButton @click="resetFilters">重置</UiButton><UiButton :aria-expanded="advanced" @click="advanced = !advanced">{{ advanced ? '收起筛选' : '高级筛选' }}</UiButton></div>
        <div v-if="advanced" class="advanced-filters">
          <label><span>模型厂家</span><UiSelect v-model:value="manufacturer" :options="manufacturers" clearable aria-label="模型厂家" placeholder="全部厂家" /></label>
          <label><span>调用类型</span><UiSelect v-model:value="kind" :options="kindOptions" clearable aria-label="调用类型" placeholder="全部类型" /></label>
          <label><span>API Key</span><UiInput v-model:value="key" placeholder="Key 名称或前缀" /></label>
          <label><span>请求 ID</span><UiInput v-model:value="requestId" placeholder="输入完整请求 ID" /></label>
          <label v-if="isAdmin"><span>用户</span><UiInput v-model:value="userFilter" placeholder="用户名称或邮箱" /></label>
          <label v-if="isAdmin"><span>上游账号</span><UiInput v-model:value="accountFilter" placeholder="账号名称或 ID" /></label>
          <label><span>开始日期</span><input v-model="dateFrom" type="date" class="input" /></label>
          <label><span>结束日期</span><input v-model="dateEnd" type="date" class="input" /></label>
        </div>
      </form>
    </UiCard>

    <UiAlert v-if="error" type="error" :title="error" />
    <UiCard :bordered="false" class="surface-card">
      <div class="logs-count"><strong>共 {{ total.toLocaleString() }} 条记录</strong><span v-if="lastUpdated">更新于 {{ formatTime(lastUpdated) }}</span></div>
      <div class="logs-table-wrap hidden md:block">
        <table class="logs-table">
          <thead><tr><th>时间</th><th>模型 / 厂家</th><th>类型</th><th>API Key<span v-if="isAdmin"> / 用户</span></th><th>状态 / 进度</th><th>规格 / 用量</th><th>费用</th><th>耗时</th><th>详情</th></tr></thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :class="{ 'is-running': row.status === 'running' }" :data-log-id="row.id">
              <td class="time-cell">{{ formatTime(row.createdAt) }}</td>
              <td><strong class="model-name">{{ row.model || '未知模型' }}</strong><small>{{ manufacturerLabel(row.manufacturer) }}</small><small v-if="row.requestedModel && row.requestedModel !== row.model">调用别名：{{ row.requestedModel }}</small></td>
              <td><span class="kind-badge" :class="row.kind">{{ kindLabel(row.kind) }}</span></td>
              <td>{{ row.apiKeyName || '—' }}<small v-if="isAdmin">{{ row.userName || '—' }}</small></td>
              <td>
                <span class="status-badge" :class="row.status"><i v-if="row.status === 'running'" />{{ logStatusLabel(row) }}</span>
                <div v-if="row.progress != null && (row.status === 'running' || row.status === 'settling')" class="log-progress" role="progressbar" :aria-label="`${row.model} 生成进度`" :aria-valuenow="row.progress" aria-valuemin="0" aria-valuemax="100">
                  <div><span :style="{ width: `${Math.min(100, Math.max(0, row.progress))}%` }" /></div><small>{{ Math.round(row.progress) }}%</small>
                </div>
                <small v-if="row.status === 'error'" class="log-error" :title="row.errorMessage || ''">{{ errorSummary(row) }}</small>
                <small v-if="isAdmin && row.errorCode">{{ row.errorCode }}</small>
              </td>
              <td>{{ logUsageLabel(row) }}</td>
              <td class="cost-cell">{{ costLabel(row) }}</td>
              <td class="duration-cell">{{ durationLabel(row) }}</td>
              <td><UiButton size="small" quaternary @click="selected = row">查看</UiButton></td>
            </tr>
            <tr v-if="!rows.length"><td colspan="9" class="logs-empty">{{ loading ? '正在加载日志…' : '暂无匹配的调用日志' }}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="grid gap-3 md:hidden">
        <p v-if="!rows.length" class="logs-empty">{{ loading ? '正在加载日志…' : '暂无匹配的调用日志' }}</p>
        <article v-for="row in rows" :key="row.id" class="mobile-log" :data-log-id="row.id">
          <div class="flex items-start justify-between gap-3"><strong class="min-w-0 break-all">{{ row.model || '未知模型' }}</strong><span class="status-badge" :class="row.status">{{ logStatusLabel(row) }}</span></div>
          <p class="mt-2 text-xs text-gray-500">{{ formatTime(row.createdAt) }} · {{ manufacturerLabel(row.manufacturer) }}</p>
          <p class="mt-1 break-words text-xs text-gray-500">{{ row.apiKeyName || '无 Key' }}<template v-if="isAdmin"> · {{ row.userName || '未知用户' }}</template></p>
          <div class="mt-3 flex flex-wrap justify-between gap-2 text-sm"><span>{{ logUsageLabel(row) }}</span><strong>{{ costLabel(row) }}</strong></div>
          <p v-if="row.status === 'error'" class="mt-2 text-xs text-red-600">{{ errorSummary(row) }}</p>
          <div v-if="row.progress != null && (row.status === 'running' || row.status === 'settling')" class="mt-3"><progress class="w-full accent-primary-500" :value="Math.min(100, Math.max(0, row.progress))" max="100" :aria-label="`${row.model} 生成进度`" /><p class="text-xs text-gray-500">{{ Math.round(row.progress) }}%</p></div>
          <div class="mt-3 flex items-center justify-between"><span class="text-xs text-gray-500">{{ durationLabel(row) }}</span><UiButton size="small" secondary @click="selected = row">查看详情</UiButton></div>
        </article>
      </div>
      <div class="logs-pagination"><UiPagination v-model:page="page" :page-size="pageSize" :item-count="total" :disabled="loading" /></div>
    </UiCard>

    <UiModal :show="!!selected" title="调用详情" width="min(760px, calc(100vw - 32px))" @update:show="(shown: boolean) => { if (!shown) selected = null }">
      <template v-if="selected">
        <div class="mb-5 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs dark:bg-dark-900"><code class="min-w-0 flex-1 break-all">{{ selected.id }}</code><UiButton size="small" secondary @click="copyRequestId">复制请求 ID</UiButton></div>
        <div class="log-detail-grid">
          <div><span>模型厂家</span><strong>{{ manufacturerLabel(selected.manufacturer) }}</strong></div>
          <div><span>状态</span><strong>{{ logStatusLabel(selected) }}<template v-if="selected.progress != null"> · {{ Math.round(selected.progress) }}%</template></strong></div>
          <div><span>实际模型</span><strong>{{ selected.model }}</strong></div>
          <div><span>调用模型</span><strong>{{ selected.requestedModel }}</strong></div>
          <div><span>费用</span><strong>{{ costLabel(selected) }}</strong></div>
          <div><span>耗时</span><strong>{{ durationLabel(selected) }}</strong></div>
          <div v-if="isAdmin"><span>接入渠道 / 账号</span><strong>{{ selected.provider }} / {{ selected.accountName || '—' }}</strong></div>
          <div v-if="selected.taskId"><span>任务 ID</span><strong>{{ selected.taskId }}</strong></div>
          <div v-if="isAdmin && selected.upstreamRequestId"><span>上游请求 ID</span><strong>{{ selected.upstreamRequestId }}</strong></div>
        </div>
        <UiAlert v-if="selected.errorMessage" type="error" :title="selected.errorCode || '调用失败'" class="detail-error">{{ selected.errorMessage }}</UiAlert>
        <h3 class="detail-title">输入摘要</h3><pre class="request-input">{{ selected.requestInput || '未记录输入摘要' }}</pre>
        <template v-if="resultLinks.length"><h3 class="detail-title">生成结果</h3><div class="result-links"><a v-for="(url, index) in resultLinks" :key="url" :href="url" target="_blank" rel="noopener noreferrer">查看{{ selected.kind === 'video' ? '视频' : '图片' }} {{ index + 1 }} ↗</a></div></template>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.logs-page { display: grid; gap: 18px; min-width: 0; }
.logs-page > .surface-card { min-width: 0; }
.logs-heading, .logs-actions, .logs-count { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.logs-heading h2 { margin: 0; color: #182338; font-size: 18px; font-weight: 800; }
.logs-heading p { margin: 6px 0 0; color: #64748b; font-size: 13px; }
.logs-actions { justify-content: flex-end; }
.refresh-toggle { display: flex; align-items: center; gap: 7px; color: #64748b; font-size: 12px; cursor: pointer; }
.logs-filters { margin-top: 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: end; }
.logs-filters label { display: grid; gap: 7px; min-width: 0; }
.logs-filters label > span { font-size: 12px; color: #475569; font-weight: 650; }
.advanced-filters { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.logs-filters input[type=date] { min-width: 0; width: 100%; min-height: 38px; }
.filter-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
.mobile-log { min-width: 0; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; }
.dark .mobile-log { border-color: #334155; }
.logs-count { margin-bottom: 18px; font-size: 13px; color: #334155; }
.logs-count > span { font-size: 12px; color: #94a3b8; }
.logs-table-wrap { min-width: 0; max-width: 100%; overflow-x: auto; }
.logs-table { width: 100%; min-width: 1060px; border-collapse: collapse; text-align: left; font-size: 13px; }
.logs-table th { padding: 11px 12px; font-weight: 650; color: #64748b; background: #f8fafc; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
.logs-table td { padding: 16px 12px; color: #334155; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
.logs-table th:last-child, .logs-table td:last-child { position: sticky; right: 0; background: #fff; border-left: 1px solid #f1f5f9; }
.logs-table th:last-child { background: #f8fafc; }
.logs-table tr.is-running { background: #f5faff; }
.logs-table small { display: block; margin-top: 5px; font-size: 11px; color: #94a3b8; }
.model-name { display: block; max-width: 260px; overflow-wrap: anywhere; color: #182338; }
.time-cell, .cost-cell, .duration-cell { white-space: nowrap; }
.time-cell { font-size: 12px; }
.kind-badge, .status-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; padding: 4px 8px; white-space: nowrap; font-size: 11px; font-weight: 650; }
.kind-badge { color: #475569; background: #f1f5f9; }
.kind-badge.image { color: #7c3aed; background: #f5f3ff; }
.kind-badge.video { color: #be185d; background: #fdf2f8; }
.status-badge.running { background: #dbeafe; color: #1d4ed8; }
.status-badge.running i { width: 6px; height: 6px; background: #2563eb; border-radius: 50%; }
.status-badge.settling { background: #fef3c7; color: #92400e; }
.status-badge.success { background: #dcfce7; color: #15803d; }
.status-badge.error { background: #fee2e2; color: #b91c1c; }
.log-progress { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.log-progress > div { width: 66px; height: 4px; overflow: hidden; border-radius: 9px; background: #dbeafe; }
.log-progress > div > span { display: block; height: 100%; background: #3b82f6; border-radius: 9px; }
.log-progress small { margin: 0; color: #2563eb; }
.logs-table .log-error { max-width: 170px; overflow-wrap: anywhere; color: #b91c1c; }
.logs-table .logs-empty { padding: 48px; text-align: center; color: #94a3b8; }
.logs-pagination { margin-top: 18px; }
.log-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 20px; }
.log-detail-grid > div { display: grid; gap: 6px; min-width: 0; }
.log-detail-grid span { color: #94a3b8; font-size: 12px; }
.log-detail-grid strong { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; color: #334155; }
.detail-error { margin-bottom: 18px; }
.detail-title { margin: 18px 0 10px; font-size: 13px; font-weight: 700; color: #475569; }
.request-input { max-height: 300px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 14px; border-radius: 10px; background: #f8fafc; color: #475569; font: 12px/1.8 ui-monospace, monospace; }
.result-links { display: flex; flex-wrap: wrap; gap: 10px; }
.result-links a { padding: 8px 12px; border: 1px solid #dbeafe; border-radius: 8px; color: #2563eb; font-size: 13px; text-decoration: none; }
@media (min-width: 1280px) { .logs-filters { grid-template-columns: repeat(2, minmax(0, 1fr)) auto; } .filter-actions { grid-column: auto; } .advanced-filters { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 520px) { .log-detail-grid { grid-template-columns: minmax(0, 1fr); } .logs-actions { justify-content: flex-start; } .logs-count { gap: 8px; } }
</style>
