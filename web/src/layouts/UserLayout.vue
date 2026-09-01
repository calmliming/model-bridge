<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api } from '../api/client'
import { useCollapsibleSidebar } from '../composables/useCollapsibleSidebar'
import { useAuthStore } from '../stores/auth'

interface HeaderUser {
  email: string
  name: string
  balance: number
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menuIconPaths = {
  overview: ['M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z'],
  models: ['M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z'],
  keys: ['M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.03 5.91c-.56-.1-1.16.03-1.56.43l-2.66 2.66H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5A6 6 0 1121.75 8.25z'],
  usage: ['M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z'],
  docs: ['M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25'],
} as const

type MenuIcon = keyof typeof menuIconPaths
const menu: Array<{ to: string; key: string; label: string; icon: MenuIcon }> = [
  { to: '/app', key: 'user-overview', label: '概览', icon: 'overview' },
  { to: '/app/models', key: 'user-models', label: '模型广场', icon: 'models' },
  { to: '/app/keys', key: 'user-keys', label: 'API Keys', icon: 'keys' },
  { to: '/app/usage', key: 'user-usage', label: '用量流水', icon: 'usage' },
  { to: '/app/docs', key: 'user-api-docs', label: 'API 文档', icon: 'docs' },
]

const titleMap: Record<string, string> = {
  'user-overview': '仪表盘',
  'user-models': '模型广场',
  'user-keys': 'API Keys',
  'user-usage': '用量流水',
  'user-api-docs': 'API 文档',
}

const subtitleMap: Record<string, string> = {
  'user-overview': '欢迎回来！这是您账户的概览。',
  'user-models': '浏览可用模型、能力分类与计费价格。',
  'user-keys': '管理您的 API Key 和调用入口。',
  'user-usage': '查看请求消耗、账单扣费和钱包流水。',
  'user-api-docs': '查看图片生成与编辑接口、参数和调用示例。',
}

const activeKey = computed(() => route.name as string)
const pageTitle = computed(() => titleMap[activeKey.value] ?? '用户中心')
const pageSubtitle = computed(() => subtitleMap[activeKey.value] ?? '管理您的 Model Bridge 账户。')
const headerUser = ref<HeaderUser | null>(null)
const displayName = computed(() => headerUser.value?.name || auth.username || 'User')
const balance = computed(() => headerUser.value?.balance ?? null)
const avatarInitials = computed(() => {
  const value = displayName.value.trim()
  return (value.slice(0, 2) || 'US').toUpperCase()
})

const sidebarOpen = ref(false)
const { collapsed: sidebarCollapsed, toggle: toggleSidebarCollapsed } = useCollapsibleSidebar('mb_user_sidebar_collapsed')
const profileOpen = ref(false)
const notificationsOpen = ref(false)
const languageOpen = ref(false)
watch(() => route.fullPath, () => {
  sidebarOpen.value = false
  profileOpen.value = false
  notificationsOpen.value = false
  languageOpen.value = false
  void loadHeaderUser()
})

onMounted(loadHeaderUser)

function formatUsd(value: number): string {
  return `$${value.toFixed(Math.abs(value) < 1 ? 4 : 2)}`
}

async function loadHeaderUser() {
  try {
    const { data } = await api.get<{ user: HeaderUser }>('/users/me')
    headerUser.value = data.user
  } catch {
    // The shared API interceptor handles expired sessions.
  }
}

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
  void router.push({ name: 'user-login' })
}
</script>

<template>
  <div class="flex h-screen h-dvh overflow-hidden bg-gray-50 dark:bg-dark-950">
    <!-- Mobile overlay -->
    <Transition name="modal-fade">
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
        @click="sidebarOpen = false"
      />
    </Transition>

    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-[232px] flex-shrink-0 flex-col border-r border-gray-200 bg-white/95 backdrop-blur-xl transition-[transform,width] duration-300 ease-out dark:border-dark-800 dark:bg-dark-900/95 lg:relative lg:z-auto lg:translate-x-0 lg:bg-white/90 lg:dark:bg-dark-900/90"
      :class="[
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        sidebarCollapsed ? 'lg:w-20' : 'lg:w-[232px]',
      ]"
      id="user-sidebar"
    >
      <button
        type="button"
        class="absolute -right-3 top-6 z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition hover:border-primary-300 hover:text-primary-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-400 dark:hover:border-primary-700 dark:hover:text-primary-300 lg:flex"
        :aria-label="sidebarCollapsed ? '展开用户侧边栏' : '收起用户侧边栏'"
        :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="toggleSidebarCollapsed"
      >
        <svg class="h-3.5 w-3.5 transition-transform" :class="sidebarCollapsed && 'rotate-180'" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div class="flex items-center gap-3 px-5 py-5">
        <span class="flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-primary shadow-glow">
          <span class="h-3.5 w-3.5 rotate-45 rounded-[4px] bg-white" />
        </span>
        <div class="leading-tight" :class="sidebarCollapsed && 'lg:hidden'">
          <strong class="block text-[15px] font-bold text-gray-900 dark:text-white">Model Bridge</strong>
          <small class="text-xs text-gray-400 dark:text-dark-400">User Console</small>
        </div>
        <button
          class="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-dark-700 lg:hidden"
          aria-label="关闭菜单"
          @click="sidebarOpen = false"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <nav class="flex-1 space-y-1 overflow-y-auto px-3 pb-4 pt-2" aria-label="用户菜单">
        <RouterLink
          v-for="item in menu"
          :key="item.key"
          :to="item.to"
          class="group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all"
          :title="sidebarCollapsed ? item.label : undefined"
          :class="
            [
              activeKey === item.key
                ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-300'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-dark-300 dark:hover:bg-dark-800 dark:hover:text-white',
              sidebarCollapsed ? 'lg:justify-center lg:px-2' : '',
            ]
          "
        >
          <svg class="h-5 w-5 flex-shrink-0 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path v-for="path in menuIconPaths[item.icon]" :key="path" stroke-linecap="round" stroke-linejoin="round" :d="path" />
          </svg>
          <span class="truncate" :class="sidebarCollapsed && 'lg:hidden'">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="m-4 flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50/80 p-3 dark:border-dark-700 dark:bg-dark-800/60" :class="sidebarCollapsed && 'lg:justify-center lg:px-2'" :title="sidebarCollapsed ? (auth.username ?? '钱包账户') : undefined">
        <span class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-100 text-[10px] font-black text-primary-700 dark:bg-primary-900/35 dark:text-primary-300">{{ avatarInitials }}</span>
        <div class="min-w-0" :class="sidebarCollapsed && 'lg:hidden'">
          <strong class="block truncate text-[13px] text-gray-900 dark:text-white">{{ auth.username }}</strong>
          <span class="text-xs text-gray-400 dark:text-dark-400">钱包账户</span>
        </div>
      </div>
    </aside>

    <div class="flex flex-col flex-1 min-w-0">
      <header
        class="relative z-30 flex min-h-[68px] flex-shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/80 sm:px-7"
      >
        <div class="flex items-center min-w-0 gap-3">
          <button
            class="p-2 -ml-1 text-gray-500 rounded-lg hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-dark-800 lg:hidden"
            aria-label="打开菜单"
            aria-controls="user-sidebar"
            :aria-expanded="sidebarOpen"
            @click="sidebarOpen = true"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div class="min-w-0">
            <h1 class="text-lg font-extrabold tracking-normal truncate text-gray-950 dark:text-white sm:text-xl">
              {{ pageTitle }}
            </h1>
            <p class="mt-0.5 truncate text-xs font-medium text-gray-500 dark:text-dark-400">
              {{ pageSubtitle }}
            </p>
          </div>
        </div>
        <div class="flex items-center flex-shrink-0 gap-2 sm:gap-3">
          <div class="relative hidden sm:block">
            <button
              class="flex items-center justify-center w-8 h-8 text-gray-500 transition rounded-full hover:bg-gray-100 hover:text-gray-800 dark:text-dark-300 dark:hover:bg-dark-800 dark:hover:text-white"
              aria-label="通知"
              type="button"
              @click="toggleNotifications"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 21h4" />
              </svg>
            </button>
            <div
              v-if="notificationsOpen"
              class="absolute right-0 z-40 w-56 p-4 mt-2 text-sm font-medium text-gray-500 bg-white border border-gray-200 shadow-xl top-full rounded-xl dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300"
            >
              暂无通知
            </div>
          </div>
          <div class="relative hidden md:block">
            <button
              class="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-gray-600 transition rounded-xl hover:bg-gray-100 dark:text-dark-300 dark:hover:bg-dark-800"
              type="button"
              aria-label="语言"
              @click="toggleLanguage"
            >
              <span class="relative inline-flex h-3.5 w-5 overflow-hidden rounded-sm bg-red-500">
                <span class="absolute w-1 h-1 bg-yellow-300 rounded-full left-1 top-1" />
              </span>
              <span>ZH</span>
              <svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              v-if="languageOpen"
              class="absolute right-0 z-40 w-40 py-1 mt-2 overflow-hidden bg-white border border-gray-200 shadow-xl top-full rounded-xl dark:border-dark-700 dark:bg-dark-800"
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
          <div
            class="hidden items-center gap-1.5 rounded-xl bg-primary-50 px-2.5 py-1 text-primary-700 dark:bg-primary-900/20 dark:text-primary-200 md:flex"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 9.5h18v9A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5v-9Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M7 9.5V6a3 3 0 0 1 3-3h8v6.5" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M16 15h.01" />
            </svg>
            <strong class="text-sm font-extrabold">{{ balance == null ? '$--' : formatUsd(balance) }}</strong>
          </div>
          <div class="relative">
            <button
              class="flex items-center gap-2 rounded-xl px-1.5 py-1 transition hover:bg-gray-100 dark:hover:bg-dark-800 sm:px-2"
              type="button"
              @click="toggleProfile"
            >
              <span class="flex items-center justify-center flex-shrink-0 text-xs font-bold text-white shadow-sm h-9 w-9 rounded-xl bg-primary-500">
                {{ avatarInitials }}
              </span>
              <span class="hidden min-w-0 text-left md:block">
                <strong class="block max-w-[180px] truncate text-[13px] font-bold text-gray-900 dark:text-white">
                  {{ displayName }}
                </strong>
                <span class="block text-[11px] font-medium text-gray-500 dark:text-dark-400">User</span>
              </span>
              <svg class="flex-shrink-0 hidden w-5 h-5 text-gray-400 md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              v-if="profileOpen"
              class="absolute right-0 top-full z-40 mt-1.5 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-dark-700 dark:bg-dark-800"
            >
              <button
                class="block w-full px-3 py-2 text-xs font-medium text-left text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-dark-300 dark:hover:bg-dark-700 dark:hover:text-white"
                type="button"
                @click="logout"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </header>
      <main class="flex-1 min-w-0 p-4 overflow-y-auto sm:p-6 lg:p-7">
        <router-view />
      </main>
    </div>
  </div>
</template>
