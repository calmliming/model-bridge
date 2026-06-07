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

const subtitleMap: Record<string, string> = {
  overview: '欢迎回来！这里是系统运行概览。',
  accounts: '管理上游服务账号、可用状态和调度能力。',
  keys: '管理中转入口、额度和访问范围。',
  users: '查看用户钱包、余额和用量入口。',
  payments: '跟踪充值订单和支付入账状态。',
  'redeem-codes': '生成和管理余额兑换码。',
  'subscription-plans': '维护可售套餐和订阅额度。',
  stats: '按模型、服务商和 API Key 分析消耗。',
  docs: '查看客户端接入说明和示例。',
  settings: '调整系统配置和安全选项。',
}

const activeKey = computed(() => route.name as string)
const pageTitle = computed(() => titleMap[activeKey.value] ?? '控制台')
const pageSubtitle = computed(() => subtitleMap[activeKey.value] ?? '管理 Model Bridge 的运行状态。')
const displayName = computed(() => auth.username ?? 'admin')
const avatarInitials = computed(() => {
  const value = displayName.value.trim()
  return (value.slice(0, 2) || 'MB').toUpperCase()
})

const sidebarOpen = ref(false)
const profileOpen = ref(false)
const notificationsOpen = ref(false)
const languageOpen = ref(false)
watch(() => route.fullPath, () => {
  sidebarOpen.value = false
  profileOpen.value = false
  notificationsOpen.value = false
  languageOpen.value = false
})

function toggleNotifications() {
  notificationsOpen.value = !notificationsOpen.value
  languageOpen.value = false
  profileOpen.value = false
}

function toggleLanguage() {
  languageOpen.value = !languageOpen.value
  notificationsOpen.value = false
  profileOpen.value = false
}

function toggleProfile() {
  profileOpen.value = !profileOpen.value
  notificationsOpen.value = false
  languageOpen.value = false
}

function logout() {
  auth.clear()
  profileOpen.value = false
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
      class="fixed inset-y-0 left-0 z-50 flex w-64 flex-shrink-0 flex-col border-r border-gray-200 bg-white/95 backdrop-blur-xl transition-transform duration-300 ease-out dark:border-dark-800 dark:bg-dark-900/95 lg:static lg:z-40 lg:translate-x-0 lg:bg-white/90 lg:dark:bg-dark-900/90"
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
        class="relative z-30 flex min-h-[68px] flex-shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/80 sm:px-7"
      >
        <div class="flex min-w-0 items-center gap-3">
          <button
            class="-ml-1 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-dark-800 lg:hidden"
            aria-label="打开菜单"
            @click="sidebarOpen = true"
          >
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div class="min-w-0">
            <h1 class="truncate text-lg font-extrabold tracking-normal text-gray-950 dark:text-white sm:text-xl">
              {{ pageTitle }}
            </h1>
            <p class="mt-0.5 truncate text-xs font-medium text-gray-500 dark:text-dark-400">
              {{ pageSubtitle }}
            </p>
          </div>
        </div>
        <div class="flex flex-shrink-0 items-center gap-2 sm:gap-3">
          <div class="relative hidden sm:block">
            <button
              class="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-dark-300 dark:hover:bg-dark-800 dark:hover:text-white"
              aria-label="通知"
              type="button"
              @click="toggleNotifications"
            >
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 21h4" />
              </svg>
            </button>
            <div
              v-if="notificationsOpen"
              class="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-4 text-sm font-medium text-gray-500 shadow-xl dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300"
            >
              暂无通知
            </div>
          </div>
          <div class="relative hidden md:block">
            <button
              class="flex items-center gap-2 rounded-xl px-2 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-100 dark:text-dark-300 dark:hover:bg-dark-800"
              type="button"
              aria-label="语言"
              @click="toggleLanguage"
            >
              <span class="relative inline-flex h-3.5 w-5 overflow-hidden rounded-sm bg-red-500">
                <span class="absolute left-1 top-1 h-1 w-1 rounded-full bg-yellow-300" />
              </span>
              <span>ZH</span>
              <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              v-if="languageOpen"
              class="absolute right-0 top-full z-40 mt-2 w-40 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-dark-700 dark:bg-dark-800"
            >
              <button
                class="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-gray-700 dark:text-dark-200"
                type="button"
                @click="languageOpen = false"
              >
                <span>简体中文</span>
                <span class="text-primary-500">ZH</span>
              </button>
            </div>
          </div>
          <div class="relative">
            <button
              class="flex items-center gap-2 rounded-xl px-1.5 py-1 transition hover:bg-gray-100 dark:hover:bg-dark-800 sm:px-2"
              type="button"
              @click="toggleProfile"
            >
              <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary-500 text-xs font-bold text-white shadow-sm">
                {{ avatarInitials }}
              </span>
              <span class="hidden min-w-0 text-left md:block">
                <strong class="block max-w-[180px] truncate text-[13px] font-bold text-gray-900 dark:text-white">
                  {{ displayName }}
                </strong>
                <span class="block text-[11px] font-medium text-gray-500 dark:text-dark-400">Admin</span>
              </span>
              <svg class="hidden h-5 w-5 flex-shrink-0 text-gray-400 md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              v-if="profileOpen"
              class="absolute right-0 top-full z-40 mt-1.5 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-dark-700 dark:bg-dark-800"
            >
              <button
                class="block w-full px-3 py-2 text-left text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-dark-300 dark:hover:bg-dark-700 dark:hover:text-white"
                type="button"
                @click="logout"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </header>
      <main class="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-7">
        <router-view />
      </main>
    </div>
  </div>
</template>
