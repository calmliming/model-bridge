<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { api, errMsg } from '../api/client'

const message = useMessage()
const loading = ref(true)
const stats = ref({ keyCount: 0, accountCount: 0, requestCount: 0 })

const cards = computed(() => [
  { label: 'API Keys', value: stats.value.keyCount, hint: '已签发的密钥' },
  { label: '上游账户', value: stats.value.accountCount, hint: 'Claude / OpenAI / Gemini' },
  { label: '中转请求', value: stats.value.requestCount, hint: '累计请求数' },
])

onMounted(async () => {
  try {
    const { data } = await api.get('/admin/overview')
    stats.value = data
  } catch (e) {
    message.error(errMsg(e))
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <h2 class="page-title">概览</h2>
    <n-grid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <n-gi v-for="c in cards" :key="c.label" span="3 m:1">
        <n-card>
          <div class="stat-label">{{ c.label }}</div>
          <div class="stat-value">{{ loading ? '—' : c.value }}</div>
          <div class="stat-hint">{{ c.hint }}</div>
        </n-card>
      </n-gi>
    </n-grid>

    <n-card title="欢迎使用 model-bridge" style="margin-top: 16px">
      <n-space vertical :size="8">
        <n-text>
          当前为<n-text type="primary"> 阶段 A 骨架版本</n-text>：管理员登录、API Key 管理已可用。
        </n-text>
        <n-text depth="3">
          后续阶段将接入 Claude / OpenAI / Gemini 上游账户与中转能力。完整路线图见仓库内的
          <n-text code>PLAN.zh-CN.md</n-text>。
        </n-text>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.stat-label {
  font-size: 13px;
  opacity: 0.6;
}
.stat-value {
  font-size: 30px;
  font-weight: 700;
  margin: 6px 0 2px;
}
.stat-hint {
  font-size: 12px;
  opacity: 0.45;
}
</style>
