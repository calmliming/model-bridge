<script setup lang="ts">
// Upstream account management lands in Phase B (OAuth onboarding for
// Claude / OpenAI / Gemini subscriptions). This is a placeholder.
</script>

<template>
  <div>
    <h2 class="page-title">上游账户</h2>
    <n-card>
      <n-empty description="上游账户管理将在阶段 B 接入" style="padding: 40px 0">
        <template #extra>
          <n-text depth="3">
            届时可在此添加 Claude / OpenAI / Gemini 订阅账户、完成 OAuth 授权，并支持多账户自动轮换。
          </n-text>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>
