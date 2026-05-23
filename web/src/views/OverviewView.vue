<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { api, errMsg } from '../api/client'

const message = useMessage()
const loading = ref(true)
const stats = ref({ keyCount: 0, accountCount: 0, requestCount: 0 })

const cards = computed(() => [
  { label: 'API Keys', value: stats.value.keyCount, hint: '已签发的访问密钥', tone: 'blue' },
  { label: '上游账户', value: stats.value.accountCount, hint: 'Claude / OpenAI / Gemini', tone: 'teal' },
  { label: '中转请求', value: stats.value.requestCount, hint: '累计请求数', tone: 'violet' },
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
  <div class="overview-page">

    <n-grid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <n-gi v-for="c in cards" :key="c.label" span="3 m:1">
        <n-card class="stat-card surface-card" :class="`is-${c.tone}`" :bordered="false">
          <div class="stat-label">{{ c.label }}</div>
          <div class="stat-value">{{ loading ? '—' : c.value }}</div>
          <div class="stat-hint">{{ c.hint }}</div>
        </n-card>
      </n-gi>
    </n-grid>

    <n-grid class="overview-grid" :cols="12" :x-gap="16" :y-gap="16" responsive="screen">
      <n-gi span="12 l:7">
        <n-card class="surface-card" :bordered="false">
          <div class="section-head">
            <div>
              <h3>当前阶段</h3>
              <p>管理员登录、API Key 管理已可用。</p>
            </div>
            <n-tag type="info" :bordered="false">Phase A</n-tag>
          </div>
          <div class="timeline">
            <div class="timeline-item is-done">
              <span />
              <div>
                <strong>控制台基础能力</strong>
                <p>登录、设置、访问密钥和账户列表。</p>
              </div>
            </div>
            <div class="timeline-item">
              <span />
              <div>
                <strong>中转与用量采集</strong>
                <p>接入请求记录、Token 消耗和成本分析。</p>
              </div>
            </div>
            <div class="timeline-item">
              <span />
              <div>
                <strong>多维度统计</strong>
                <p>按 API Key、账户、日期和模型聚合展示。</p>
              </div>
            </div>
          </div>
        </n-card>
      </n-gi>
      <n-gi span="12 l:5">
        <n-card class="surface-card quick-card" :bordered="false">
          <div class="section-head">
            <div>
              <h3>快捷入口</h3>
              <p>常用管理动作</p>
            </div>
          </div>
          <router-link class="quick-link" to="/accounts">
            <span>上游账户</span>
            <strong>管理 Claude / OpenAI / Gemini</strong>
          </router-link>
          <router-link class="quick-link" to="/keys">
            <span>API Keys</span>
            <strong>签发和停用访问密钥</strong>
          </router-link>
          <router-link class="quick-link" to="/settings">
            <span>系统设置</span>
            <strong>更新管理员密码</strong>
          </router-link>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<style scoped>
.overview-page {
  display: grid;
  gap: 16px;
}

.overview-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 30px;
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 24px;
  background:
    linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(20, 184, 166, 0.08)),
    rgba(255, 255, 255, 0.82);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.07);
}

.hero-eyebrow {
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.overview-hero h2 {
  margin: 10px 0 0;
  color: #0f172a;
  font-size: 34px;
  line-height: 1.16;
}

.overview-hero p {
  max-width: 560px;
  margin: 12px 0 0;
  color: rgba(15, 23, 42, 0.58);
  font-size: 14px;
  line-height: 1.8;
}

.hero-status {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(20, 184, 166, 0.18);
  border-radius: 999px;
  color: #0f766e;
  background: rgba(240, 253, 250, 0.9);
  font-size: 13px;
}

.hero-status span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #14b8a6;
}

.stat-card {
  position: relative;
  overflow: hidden;
}

.stat-card::after {
  content: '';
  position: absolute;
  width: 96px;
  height: 96px;
  right: -28px;
  top: -28px;
  border-radius: 999px;
  opacity: 0.15;
}

.stat-card.is-blue::after {
  background: #2563eb;
}

.stat-card.is-teal::after {
  background: #14b8a6;
}

.stat-card.is-violet::after {
  background: #8b5cf6;
}

.stat-label {
  font-size: 13px;
  color: rgba(15, 23, 42, 0.58);
}

.stat-value {
  color: #0f172a;
  font-size: 34px;
  font-weight: 820;
  margin: 8px 0 2px;
}

.stat-hint {
  font-size: 12px;
  color: rgba(15, 23, 42, 0.42);
}

.overview-grid {
  margin-top: 0;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 18px;
}

.section-head h3 {
  margin: 0;
  color: #0f172a;
  font-size: 17px;
}

.section-head p {
  margin: 5px 0 0;
  color: rgba(15, 23, 42, 0.48);
  font-size: 13px;
}

.timeline {
  display: grid;
  gap: 14px;
}

.timeline-item {
  display: flex;
  gap: 12px;
}

.timeline-item > span {
  flex: 0 0 auto;
  width: 11px;
  height: 11px;
  margin-top: 5px;
  border-radius: 999px;
  background: #cbd5e1;
  box-shadow: 0 0 0 5px rgba(148, 163, 184, 0.12);
}

.timeline-item.is-done > span {
  background: #14b8a6;
  box-shadow: 0 0 0 5px rgba(20, 184, 166, 0.12);
}

.timeline-item strong {
  color: #0f172a;
  font-size: 14px;
}

.timeline-item p {
  margin: 4px 0 0;
  color: rgba(15, 23, 42, 0.5);
  font-size: 13px;
}

.quick-card {
  height: 100%;
}

.quick-link {
  display: block;
  padding: 14px;
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 14px;
  color: inherit;
  text-decoration: none;
  background: #f8fafc;
}

.quick-link + .quick-link {
  margin-top: 10px;
}

.quick-link span,
.quick-link strong {
  display: block;
}

.quick-link span {
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
}

.quick-link strong {
  margin-top: 5px;
  color: rgba(15, 23, 42, 0.72);
  font-size: 13px;
}

@media (max-width: 720px) {
  .overview-hero {
    flex-direction: column;
    padding: 24px;
  }

  .overview-hero h2 {
    font-size: 28px;
  }
}
</style>
