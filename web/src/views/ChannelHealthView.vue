<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, errMsg } from '../api/client'
import LazyEChart from '../components/LazyEChart.vue'
import '../styles/operations.css'

interface Settings { minSamples: number; errorRatePercent: number; ttftP95Ms: number }
interface HealthRow { id: string; label: string; provider: string; requests: number; eligible: number; success: number; failures: number; excluded: number; canceled: number; policy: number; requestErrors: number; errorRatePercent: number | null; ttftSamples: number; ttftP95Ms: number | null; latencyP95Ms: number | null; state: 'healthy' | 'warning' | 'insufficient'; alerts: string[] }
interface Snapshot { to: number; settings: Settings; rows: HealthRow[]; truncated: boolean; alerts: Array<{ id: string; label: string; reasons: string[] }>; trend: Array<{ at: number; requests: number; success: number; failures: number; excluded: number }> }
const snapshot = ref<Snapshot | null>(null)
const hours = ref(24), groupBy = ref('account'), provider = ref(''), groupId = ref('')
const groups = ref<Array<{ id: string; name: string }>>([])
const loading = ref(false), saving = ref(false), error = ref(''), notice = ref('')
const settings = ref<Settings>({ minSamples: 20, errorRatePercent: 10, ttftP95Ms: 10000 })
const providers = ['claude', 'openai', 'gemini', 'antigravity', 'deepseek', 'xiaomi', 'qwen', 'zhipu', 'kimi', 'minimax', 'grok', 'sub2api']
let sequence = 0, timer: ReturnType<typeof setInterval> | undefined
let disposed = false
const totals = computed(() => (snapshot.value?.rows ?? []).reduce((sum, row) => ({ requests: sum.requests + row.requests, eligible: sum.eligible + row.eligible, failures: sum.failures + row.failures, excluded: sum.excluded + row.excluded }), { requests: 0, eligible: 0, failures: 0, excluded: 0 }))
const chart = computed(() => ({ color: ['#228b71', '#e06555', '#b0b8c4'], tooltip: { trigger: 'axis' }, legend: { data: ['成功', '上游失败', '已排除'] }, grid: { left: 46, right: 20, top: 42, bottom: 35 }, xAxis: { type: 'category', data: snapshot.value?.trend.map(item => new Date(item.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' })) ?? [] }, yAxis: { type: 'value', minInterval: 1 }, series: ['success', 'failures', 'excluded'].map((key, index) => ({ name: ['成功', '上游失败', '已排除'][index], type: 'bar', stack: 'total', data: snapshot.value?.trend.map(item => item[key as 'success' | 'failures' | 'excluded']) ?? [] })) }))
function ms(value: number | null) { return value == null ? '—' : `${(value / 1000).toFixed(2)} s` }
async function load() {
  const current = ++sequence
  loading.value = true; error.value = ''
  try {
    const { data } = await api.get('/admin/channel-health', { params: { hours: hours.value, groupBy: groupBy.value, provider: provider.value || undefined, groupId: groupId.value || undefined } })
    if (current === sequence) snapshot.value = data
  } catch (e) { if (current === sequence) error.value = errMsg(e) }
  finally { if (current === sequence) loading.value = false }
}
async function save() {
  saving.value = true; notice.value = ''
  try { await api.put('/admin/channel-health/settings', settings.value); notice.value = '告警阈值已保存。'; await load() }
  catch (e) { error.value = errMsg(e) }
  finally { saving.value = false }
}
watch([hours, groupBy, provider, groupId], load)
onMounted(async () => {
  await load()
  if (disposed) return
  if (snapshot.value) settings.value = { ...snapshot.value.settings }
  try { groups.value = (await api.get('/admin/account-groups')).data.groups } catch { /* Health remains usable without group choices. */ }
  if (disposed) return
  timer = setInterval(() => { if (!loading.value && !document.hidden) void load() }, 30000)
})
onBeforeUnmount(() => { disposed = true; sequence++; if (timer) clearInterval(timer) })
</script>

<template>
  <div class="operations-page">
    <header class="op-heading"><div><p class="op-eyebrow">运行状态</p><h2>渠道健康</h2><p>根据实际请求观察可靠性与首 Token 延迟，每 30 秒刷新。</p></div><button class="op-button" :disabled="loading" @click="load">{{ loading ? '正在刷新…' : '立即刷新' }}</button></header>
    <p v-if="error" class="op-error" role="alert">{{ error }}<span v-if="snapshot"> · 当前保留上次成功加载的数据。</span></p>
    <p v-if="notice" class="op-notice" role="status">{{ notice }}</p>
    <div class="op-toolbar"><label>时间范围<select v-model="hours"><option :value="1">近 1 小时</option><option :value="6">近 6 小时</option><option :value="24">近 24 小时</option><option :value="168">近 7 天</option></select></label><label>查看维度<select v-model="groupBy"><option value="account">账号</option><option value="provider">服务商</option><option value="model">模型</option></select></label><label>服务商<select v-model="provider"><option value="">全部服务商</option><option v-for="item in providers" :key="item">{{ item }}</option></select></label><label>当前账号分组<select v-model="groupId"><option value="">全部分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label></div>
    <div class="op-metrics"><article><span>观察请求</span><strong>{{ totals.requests.toLocaleString() }}</strong></article><article><span>上游错误率</span><strong>{{ totals.eligible ? `${(totals.failures / totals.eligible * 100).toFixed(1)}%` : '—' }}</strong></article><article><span>当前告警</span><strong>{{ snapshot?.alerts.length ?? 0 }}</strong></article><article><span>排除的请求</span><strong>{{ totals.excluded }}</strong></article></div>
    <section v-if="snapshot?.alerts.length" class="op-alerts" aria-label="当前告警"><strong>需要关注</strong><p v-for="alert in snapshot.alerts" :key="alert.id">{{ alert.label }}：{{ alert.reasons.join('；') }}</p></section>
    <section class="op-panel"><div class="op-panel-title"><h3>请求趋势</h3><span v-if="snapshot">更新于 {{ new Date(snapshot.to).toLocaleTimeString('zh-CN') }}</span></div><LazyEChart v-if="snapshot?.trend.length" :option="chart" height="240px" /><p v-else class="op-empty">所选范围暂无请求记录。</p></section>
    <section class="op-panel"><div class="op-panel-title"><h3>健康明细</h3><span>策略拒绝、客户端取消和请求参数错误单独统计</span></div><p v-if="snapshot?.truncated" class="op-error">当前仅展示请求较多或失败较多的 500 项，汇总卡片也仅包含这些项。请缩小筛选范围。</p>
      <div class="op-table-wrap"><table class="op-table"><thead><tr><th>渠道 / 模型</th><th>状态</th><th>有效样本</th><th>上游失败</th><th>错误率</th><th>首 Token P95</th><th>总耗时 P95</th><th>排除请求</th></tr></thead><tbody><tr v-for="row in snapshot?.rows" :key="`${row.provider}:${row.id}`"><td><strong>{{ row.label }}</strong><small>{{ row.provider }}</small></td><td><span class="op-badge" :class="row.state" :title="row.alerts.join('；')">{{ { healthy: '正常', warning: '告警', insufficient: '样本不足' }[row.state] }}</span></td><td>{{ row.eligible }}</td><td>{{ row.failures }}</td><td>{{ row.errorRatePercent == null ? '—' : `${row.errorRatePercent.toFixed(1)}%` }}</td><td>{{ ms(row.ttftP95Ms) }}<small>{{ row.ttftSamples }} 个延迟样本</small></td><td>{{ ms(row.latencyP95Ms) }}</td><td>{{ row.excluded }}<small>取消 {{ row.canceled }} · 策略 {{ row.policy }} · 参数 {{ row.requestErrors }}</small></td></tr><tr v-if="!snapshot?.rows.length"><td class="op-empty" colspan="8">{{ loading ? '正在加载健康数据…' : '暂无数据；没有请求记录的渠道不会被标记为正常。' }}</td></tr></tbody></table></div>
    </section>
    <section class="op-panel"><h3>站内告警阈值</h3><form class="op-toolbar" @submit.prevent="save"><label>最少有效样本<input v-model.number="settings.minSamples" type="number" min="5" max="10000" required /></label><label>上游错误率（%）<input v-model.number="settings.errorRatePercent" type="number" min="1" max="100" step="0.1" required /></label><label>首 Token P95（ms）<input v-model.number="settings.ttftP95Ms" type="number" min="100" max="600000" required /></label><button class="op-button" :disabled="saving">{{ saving ? '正在保存…' : '保存阈值' }}</button></form><p class="op-hint">样本达到阈值后才产生告警；延迟告警还要求足够的成功请求延迟样本。告警随当前窗口恢复自动消失。分组筛选按账号当前归属计算。</p></section>
  </div>
</template>
