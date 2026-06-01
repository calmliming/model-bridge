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
  { label: link('/overview', '仪表盘'), key: 'overview' },
  { label: link('/accounts', '上游账户'), key: 'accounts' },
  { label: link('/keys', 'API Keys'), key: 'keys' },
  { label: link('/users', '用户钱包'), key: 'users' },
  { label: link('/stats', '用量统计'), key: 'stats' },
  { label: link('/docs', '使用文档'), key: 'docs' },
  { label: link('/settings', '设置'), key: 'settings' },
]

const activeKey = computed(() => route.name as string)
const pageTitle = computed(() => {
  const current = menuOptions.find((item) => item.key === activeKey.value)
  return typeof current?.key === 'string'
    ? {
        overview: '仪表盘',
        accounts: '上游账户',
        keys: 'API Keys',
        users: '用户钱包',
        stats: '用量统计',
        docs: '使用文档',
        settings: '系统设置',
      }[current.key] ?? '控制台'
    : '控制台'
})

function logout() {
  auth.clear()
  void router.push({ name: 'login' })
}
</script>

<template>
  <n-layout class="admin-layout" has-sider>
    <n-layout-sider
      bordered
      class="admin-sider"
      :width="252"
      content-style="height: 100%; display: flex; flex-direction: column;"
    >
      <div class="brand">
        <span class="brand-mark">
          <span />
        </span>
        <div>
          <strong>Model Bridge</strong>
          <small>AI API Gateway</small>
        </div>
      </div>
      <div class="nav-label">管理</div>
      <n-menu class="side-menu" :value="activeKey" :options="menuOptions" :indent="18" />
      <div class="sider-footer">
        <div class="status-dot" />
        <div>
          <strong>Relay Ready</strong>
          <span>控制台在线</span>
        </div>
      </div>
    </n-layout-sider>
    <n-layout class="main-layout">
      <n-layout-header class="header">
        <div class="header-title">{{ pageTitle }}</div>
        <n-space align="center" :size="12">
          <span class="header-user">{{ auth.username }}</span>
          <n-button secondary size="small" @click="logout">退出登录</n-button>
        </n-space>
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
.admin-layout {
  height: 100vh;
  height: 100dvh;
  background:
    radial-gradient(820px 360px at 24% -12%, rgba(59, 130, 246, 0.12), transparent 60%),
    radial-gradient(620px 300px at 95% 8%, rgba(20, 184, 166, 0.12), transparent 58%),
    #f5f7fb;
}

.admin-sider {
  background: rgba(255, 255, 255, 0.86);
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
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: #0f172a;
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.2);
}

.brand-mark span {
  width: 15px;
  height: 15px;
  border-radius: 5px;
  background: linear-gradient(135deg, #34d399, #60a5fa);
  transform: rotate(45deg);
}

.brand strong,
.brand small {
  display: block;
}

.brand strong {
  color: #0f172a;
  font-size: 18px;
  line-height: 1.2;
}

.brand small {
  margin-top: 4px;
  color: rgba(15, 23, 42, 0.48);
  font-size: 12px;
}

.nav-label {
  padding: 4px 22px 8px;
  color: rgba(15, 23, 42, 0.4);
  font-size: 12px;
  font-weight: 700;
}

.side-menu {
  flex: 1;
}

.side-menu :deep(.n-menu-item-content) {
  margin: 3px 12px;
  border-radius: 12px;
}

.side-menu :deep(.n-menu-item-content--selected) {
  background: #eef6ff;
}

.sider-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px;
  padding: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.92);
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #14b8a6;
  box-shadow: 0 0 0 5px rgba(20, 184, 166, 0.12);
}

.sider-footer strong,
.sider-footer span {
  display: block;
}

.sider-footer strong {
  color: #0f172a;
  font-size: 13px;
}

.sider-footer span {
  margin-top: 2px;
  color: rgba(15, 23, 42, 0.46);
  font-size: 12px;
}

.main-layout {
  background: transparent;
  min-width: 0;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 74px;
  padding: 0 30px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(18px);
}

.header-title {
  color: #0f172a;
  font-size: 18px;
  font-weight: 800;
}

.header-user {
  padding: 6px 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 999px;
  color: rgba(15, 23, 42, 0.68);
  background: rgba(255, 255, 255, 0.72);
  font-size: 13px;
}

.content {
  height: calc(100vh - 74px);
  height: calc(100dvh - 74px);
  padding: 28px 30px;
  min-width: 0;
}

.content-inner {
  width: 100%;
  min-width: 0;
}
</style>
