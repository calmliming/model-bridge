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
  { label: link('/app', '概览'), key: 'user-overview' },
  { label: link('/app/keys', 'API Keys'), key: 'user-keys' },
  { label: link('/app/usage', '用量流水'), key: 'user-usage' },
]

const activeKey = computed(() => route.name as string)
const pageTitle = computed(() => ({
  'user-overview': '用户概览',
  'user-keys': 'API Keys',
  'user-usage': '用量流水',
}[activeKey.value] ?? '用户中心')
)

function logout() {
  auth.clear()
  void router.push({ name: 'user-login' })
}
</script>

<template>
  <n-layout class="user-layout" has-sider>
    <n-layout-sider
      bordered
      class="user-sider"
      :width="232"
      content-style="height: 100%; display: flex; flex-direction: column;"
    >
      <div class="brand">
        <span class="brand-mark"><span /></span>
        <div>
          <strong>Model Bridge</strong>
          <small>User Console</small>
        </div>
      </div>
      <n-menu class="side-menu" :value="activeKey" :options="menuOptions" :indent="18" />
      <div class="sider-footer">
        <strong>{{ auth.username }}</strong>
        <span>钱包账户</span>
      </div>
    </n-layout-sider>
    <n-layout class="main-layout">
      <n-layout-header class="header">
        <div class="header-title">{{ pageTitle }}</div>
        <n-button secondary size="small" @click="logout">退出登录</n-button>
      </n-layout-header>
      <n-layout-content class="content" :native-scrollbar="false">
        <div class="content-inner">
          <router-view />
        </div>
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<style scoped>
.user-layout {
  height: 100vh;
  height: 100dvh;
  background: #f6f8fb;
}

.user-sider {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(18px);
}

.brand {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 22px 22px 20px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #0f172a;
}

.brand-mark span {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(135deg, #22c55e, #38bdf8);
  transform: rotate(45deg);
}

.brand strong,
.brand small,
.sider-footer strong,
.sider-footer span {
  display: block;
}

.brand strong {
  color: #0f172a;
  font-size: 17px;
}

.brand small,
.sider-footer span {
  color: rgba(15, 23, 42, 0.52);
  font-size: 12px;
}

.side-menu {
  flex: 1;
}

.side-menu :deep(.n-menu-item-content) {
  margin: 3px 12px;
  border-radius: 10px;
}

.sider-footer {
  margin: 16px;
  padding: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  background: #f8fafc;
}

.main-layout {
  min-width: 0;
  background: transparent;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 70px;
  padding: 0 28px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.74);
  backdrop-filter: blur(18px);
}

.header-title {
  color: #0f172a;
  font-size: 18px;
  font-weight: 800;
}

.content {
  height: calc(100vh - 70px);
  height: calc(100dvh - 70px);
  min-width: 0;
  padding: 26px 28px;
}

.content-inner {
  width: 100%;
  min-width: 0;
}
</style>
