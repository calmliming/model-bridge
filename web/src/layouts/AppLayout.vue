<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menu = [
  { to: '/overview', key: 'overview', label: '仪表盘' },
  { to: '/accounts', key: 'accounts', label: '上游账户' },
  { to: '/keys', key: 'keys', label: 'API Keys' },
  { to: '/users', key: 'users', label: '用户钱包' },
  { to: '/payments', key: 'payments', label: '充值订单' },
  { to: '/redeem-codes', key: 'redeem-codes', label: '兑换码' },
  { to: '/subscription-plans', key: 'subscription-plans', label: '订阅套餐' },
  { to: '/stats', key: 'stats', label: '用量统计' },
  { to: '/docs', key: 'docs', label: '使用文档' },
  { to: '/settings', key: 'settings', label: '设置' },
]

const titleMap: Record<string, string> = {
  overview: '仪表盘',
  accounts: '上游账户',
  keys: 'API Keys',
  users: '用户钱包',
  payments: '充值订单',
  'redeem-codes': '兑换码',
  'subscription-plans': '订阅套餐',
  stats: '用量统计',
  docs: '使用文档',
  settings: '系统设置',
}

const activeKey = computed(() => route.name as string)
const pageTitle = computed(() => titleMap[activeKey.value] ?? '控制台')

function logout() {
  auth.clear()
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-gray-50 dark:bg-dark-950">
    <!-- Sidebar -->
    <aside
      class="flex w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white/90 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/90"
    >
      <div class="flex items-center gap-3 px-5 py-5">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
          <span class="h-3.5 w-3.5 rotate-45 rounded-[4px] bg-white" />
        </span>
        <div class="leading-tight">
          <strong class="block text-base font-bold text-gray-900 dark:text-white">Model Bridge</strong>
          <small class="text-xs text-gray-400 dark:text-dark-400">AI API Gateway</small>
        </div>
      </div>

      <div class="px-5 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-dark-500">
        管理
      </div>
      <nav class="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        <RouterLink
          v-for="item in menu"
          :key="item.key"
          :to="item.to"
          class="flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all"
          :class="
            activeKey === item.key
              ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-300'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-dark-300 dark:hover:bg-dark-800 dark:hover:text-white'
          "
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="m-4 flex items-center gap-2.5 rounded-2xl border border-gray-100 bg-gray-50/80 p-3.5 dark:border-dark-700 dark:bg-dark-800/60">
        <span class="h-2.5 w-2.5 rounded-full bg-primary-500 shadow-[0_0_0_5px_rgba(20,184,166,0.12)]" />
        <div class="leading-tight">
          <strong class="block text-[13px] text-gray-900 dark:text-white">Relay Ready</strong>
          <span class="text-xs text-gray-400 dark:text-dark-400">控制台在线</span>
        </div>
      </div>
    </aside>

    <!-- Main -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex h-[68px] flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white/80 px-7 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/80"
      >
        <h1 class="text-lg font-bold text-gray-900 dark:text-white">{{ pageTitle }}</h1>
        <div class="flex items-center gap-3">
          <span
            class="rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-[13px] text-gray-600 dark:border-dark-700 dark:bg-dark-800 dark:text-gray-300"
          >
            {{ auth.username }}
          </span>
          <button class="btn btn-secondary btn-sm" @click="logout">退出登录</button>
        </div>
      </header>
      <main class="min-w-0 flex-1 overflow-y-auto p-7">
        <router-view />
      </main>
    </div>
  </div>
</template>
