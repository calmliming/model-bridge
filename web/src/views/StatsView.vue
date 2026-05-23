<script setup lang="ts">
// Usage & cost statistics (charts) land in Phase E, once relay traffic
// is being recorded. This is a placeholder.
</script>

<template>
  <div class="stats-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">用量统计</h2>
        <div class="page-subtitle">Token、成本和调用趋势的统计面板预留位。</div>
      </div>
    </div>

    <section class="stats-hero">
      <div>
        <div class="hero-eyebrow">Analytics Preview</div>
        <h3>统计能力将在阶段 E 接入</h3>
        <p>届时可按 API Key、上游账户、日期和模型维度查看消耗、成本和趋势。</p>
      </div>
      <div class="chart-preview">
        <span class="bar is-small" />
        <span class="bar" />
        <span class="bar is-large" />
        <span class="bar is-mid" />
        <span class="bar is-high" />
        <span class="bar" />
      </div>
    </section>

    <n-grid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <n-gi span="3 m:1">
        <n-card class="surface-card" :bordered="false">
          <div class="metric-label">Token 消耗</div>
          <div class="metric-value">Pending</div>
          <div class="metric-hint">按模型和日期聚合</div>
        </n-card>
      </n-gi>
      <n-gi span="3 m:1">
        <n-card class="surface-card" :bordered="false">
          <div class="metric-label">成本分析</div>
          <div class="metric-value">Pending</div>
          <div class="metric-hint">按服务商拆分费用</div>
        </n-card>
      </n-gi>
      <n-gi span="3 m:1">
        <n-card class="surface-card" :bordered="false">
          <div class="metric-label">调用来源</div>
          <div class="metric-value">Pending</div>
          <div class="metric-hint">按 API Key 追踪</div>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<style scoped>
.stats-page {
  display: grid;
  gap: 16px;
}

.stats-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
  gap: 28px;
  align-items: center;
  padding: 28px;
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 24px;
  background:
    linear-gradient(135deg, rgba(37, 99, 235, 0.08), rgba(20, 184, 166, 0.08)),
    #ffffff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.07);
}

.hero-eyebrow {
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.stats-hero h3 {
  margin: 10px 0 0;
  color: #0f172a;
  font-size: 28px;
}

.stats-hero p {
  max-width: 560px;
  margin: 10px 0 0;
  color: rgba(15, 23, 42, 0.58);
  line-height: 1.8;
}

.chart-preview {
  height: 180px;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  align-items: end;
  gap: 12px;
  padding: 22px 18px 16px;
  border: 1px solid rgba(15, 23, 42, 0.07);
  border-radius: 20px;
  background:
    linear-gradient(rgba(15, 23, 42, 0.05) 1px, transparent 1px),
    rgba(255, 255, 255, 0.66);
  background-size: 100% 34px;
}

.bar {
  height: 54%;
  border-radius: 999px 999px 6px 6px;
  background: linear-gradient(180deg, #2563eb, #14b8a6);
}

.bar.is-small {
  height: 32%;
}

.bar.is-mid {
  height: 48%;
}

.bar.is-large {
  height: 78%;
}

.bar.is-high {
  height: 66%;
}

.metric-label {
  color: rgba(15, 23, 42, 0.54);
  font-size: 13px;
}

.metric-value {
  margin-top: 8px;
  color: #0f172a;
  font-size: 24px;
  font-weight: 800;
}

.metric-hint {
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.42);
  font-size: 12px;
}

@media (max-width: 820px) {
  .stats-hero {
    grid-template-columns: 1fr;
  }
}
</style>
