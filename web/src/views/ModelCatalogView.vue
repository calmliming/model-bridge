<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, errMsg } from '../api/client'
import '../styles/operations.css'

interface Model { id: string; display_name?: string; context_window?: number; max_context_window?: number; input_modalities?: string[]; supported_reasoning_levels?: Array<{ effort: string }> }
interface CatalogAccount { id: string; name: string; provider: string; status: string; supported: boolean; syncedAt: number | null; stale: boolean; error: string | null; models: Model[] }
const accounts = ref<CatalogAccount[]>([])
const selectedId = ref('')
const filter = ref('')
const loading = ref(false)
const syncing = ref(false)
const error = ref('')
const notice = ref('')
const selected = computed(() => accounts.value.find(account => account.id === selectedId.value))
const models = computed(() => (selected.value?.models ?? []).filter(model => `${model.id} ${model.display_name ?? ''}`.toLowerCase().includes(filter.value.toLowerCase())))
const totalModels = computed(() => new Set(accounts.value.flatMap(account => account.models.map(model => model.id))).size)
const syncedCount = computed(() => accounts.value.filter(account => account.syncedAt != null).length)
function time(value: number | null) { return value == null ? '尚未同步' : new Date(value).toLocaleString('zh-CN') }
async function load() {
  loading.value = true
  error.value = ''
  try {
    accounts.value = (await api.get('/admin/model-catalog')).data.accounts
    if (!accounts.value.some(account => account.id === selectedId.value)) selectedId.value = accounts.value.find(account => account.supported)?.id ?? accounts.value[0]?.id ?? ''
  } catch (e) { error.value = errMsg(e) }
  finally { loading.value = false }
}
async function sync() {
  if (!selected.value) return
  syncing.value = true
  error.value = ''; notice.value = ''
  try {
    const { data } = await api.post(`/admin/model-catalog/${encodeURIComponent(selected.value.id)}/sync`)
    notice.value = `同步完成，获取 ${data.catalog.models.length} 个模型。`
    await load()
  } catch (e) { error.value = errMsg(e) }
  finally { syncing.value = false }
}
onMounted(load)
</script>

<template>
  <div class="operations-page">
    <header class="op-heading"><div><p class="op-eyebrow">模型与能力</p><h2>动态模型目录</h2><p>查看每个账号发现的模型、上下文窗口和输入能力。</p></div><button class="op-button" :disabled="loading || syncing" @click="load">{{ loading ? '正在刷新…' : '刷新目录' }}</button></header>
    <p v-if="error" class="op-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="op-notice" role="status">{{ notice }}</p>
    <div class="op-metrics"><article><span>可同步账号</span><strong>{{ accounts.filter(account => account.supported).length }}</strong></article><article><span>已有同步结果</span><strong>{{ syncedCount }}</strong></article><article><span>已发现模型</span><strong>{{ totalModels }}</strong></article></div>
    <section class="op-panel">
      <div class="op-toolbar"><label>上游账号<select v-model="selectedId" :disabled="syncing"><option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.name }} · {{ account.provider }}</option></select></label><label class="op-grow">查找模型<input v-model="filter" type="search" placeholder="输入模型名称" /></label><button class="op-button op-primary" :disabled="syncing || !selected?.supported || selected.status === 'disabled'" @click="sync">{{ syncing ? '正在同步…' : '同步所选账号' }}</button></div>
      <template v-if="selected">
        <div class="op-context"><span>最近成功同步：{{ time(selected.syncedAt) }}</span><span v-if="selected.syncedAt && selected.stale" class="op-badge warning">等待更新</span><span v-if="selected.status === 'disabled'" class="op-badge">账号已停用</span></div>
        <p v-if="selected.error" class="op-error">上次同步：{{ selected.error }}。保留最近一次有效结果。</p>
        <p v-if="!selected.supported" class="op-hint">该服务商使用现有静态目录或专用模型查询，暂不支持在此同步。</p>
      </template>
      <div class="op-table-wrap"><table class="op-table"><thead><tr><th>模型</th><th>输入能力</th><th>上下文 / 最大窗口</th><th>推理强度</th></tr></thead><tbody><tr v-for="model in models" :key="model.id"><td><strong>{{ model.id }}</strong><small v-if="model.display_name">{{ model.display_name }}</small></td><td>{{ model.input_modalities?.join('、') || '上游未提供' }}</td><td>{{ model.context_window?.toLocaleString() ?? '—' }} / {{ model.max_context_window?.toLocaleString() ?? '—' }}</td><td>{{ model.supported_reasoning_levels?.map(level => level.effort).join('、') || '上游未提供' }}</td></tr><tr v-if="!models.length"><td colspan="4" class="op-empty">{{ loading ? '正在加载目录…' : !accounts.length ? '添加上游账号后，即可同步模型目录。' : filter ? '没有匹配的模型。' : '暂无同步结果，可选择账号后手动同步。' }}</td></tr></tbody></table></div>
      <p class="op-hint">系统每 6 小时尝试更新，失败保留已有结果。客户端只能看到其账号池及 Key、分组允许的模型；目录中的能力以同步结果为准，实际调用仍取决于账号权限和额度。</p>
    </section>
  </div>
</template>
