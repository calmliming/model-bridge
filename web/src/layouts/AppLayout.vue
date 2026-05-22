<script setup lang="ts">
import { computed, h } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import type { MenuOption } from 'naive-ui'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

function link(to: string, label: string) {
  return () => h(RouterLink, { to }, { default: () => label })
}

const menuOptions: MenuOption[] = [
  { label: link('/overview', '概览'), key: 'overview' },
  { label: link('/accounts', '上游账户'), key: 'accounts' },
  { label: link('/keys', 'API Keys'), key: 'keys' },
  { label: link('/stats', '用量统计'), key: 'stats' },
  { label: link('/settings', '设置'), key: 'settings' },
]

const activeKey = computed(() => route.name as string)

function logout() {
  auth.clear()
  void router.push({ name: 'login' })
}
</script>

<template>
  <n-layout has-sider style="height: 100vh">
    <n-layout-sider bordered :width="220" content-style="padding-top: 8px;">
      <div class="brand">
        <span class="brand-dot" />
        <span>model-bridge</span>
      </div>
      <n-menu :value="activeKey" :options="menuOptions" :indent="20" />
    </n-layout-sider>
    <n-layout>
      <n-layout-header bordered class="header">
        <div class="header-title">AI API 中转平台</div>
        <n-space align="center" :size="14">
          <span class="header-user">{{ auth.username }}</span>
          <n-button quaternary size="small" @click="logout">退出登录</n-button>
        </n-space>
      </n-layout-header>
      <n-layout-content class="content" :native-scrollbar="false">
        <router-view />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 18px;
  font-weight: 700;
  padding: 12px 24px 18px;
}
.brand-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b8cff, #9d7bff);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 24px;
}
.header-title {
  font-size: 15px;
  font-weight: 600;
}
.header-user {
  opacity: 0.65;
  font-size: 13px;
}
.content {
  padding: 24px;
}
</style>
