<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import SystemVersionBadge from '../components/SystemVersionBadge.vue'
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

const sidebarOpen = ref(false)
watch(() => route.fullPath, () => { sidebarOpen.value = false })

function logout() {
  auth.clear()
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-gray-50 dark:bg-dark-950">
    <!-- Mobile overlay -->
    <Transition name="modal-fade">
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
        @click="sidebarOpen = false"
      />
    </Transition>

    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white/95 backdrop-blur-xl transition-transform duration-300 ease-out dark:border-dark-800 dark:bg-dark-900/95 lg:static lg:z-auto lg:translate-x-0 lg:bg-white/90 lg:dark:bg-dark-900/90"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex items-center gap-3 px-5 py-5">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
          <span class="h-3.5 w-3.5 rotate-45 rounded-[4px] bg-white" />
        </span>
        <div class="min-w-0 leading-tight">
          <strong class="block text-base font-bold text-gray-900 dark:text-white">Model Bridge</strong>
          <SystemVersionBadge class="mt-1" />
        </div>
        <button
          class="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-dark-700 lg:hidden"
          aria-label="关闭菜单"
          @click="sidebarOpen = false"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
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
        class="flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white/80 px-4 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/80 sm:h-[68px] sm:px-7"
      >
        <div class="flex min-w-0 items-center gap-2">
          <button
            class="-ml-1 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-dark-800 lg:hidden"
            aria-label="打开菜单"
            @click="sidebarOpen = true"
          >
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 class="truncate text-base font-bold text-gray-900 dark:text-white sm:text-lg">{{ pageTitle }}</h1>
        </div>
        <div class="flex flex-shrink-0 items-center gap-2 sm:gap-3">
          <span
            class="hidden max-w-[40vw] truncate rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-[13px] text-gray-600 dark:border-dark-700 dark:bg-dark-800 dark:text-gray-300 sm:inline-block"
          >
            {{ auth.username }}
          </span>
          <button class="btn btn-secondary btn-sm" @click="logout">退出登录</button>
        </div>
      </header>
      <main class="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-7">
        <router-view />
      </main>
    </div>
  </div>
</template>
