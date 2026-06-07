<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'

interface HeaderUser {
  email: string
  name: string
  balance: number
}

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menu = [
  { to: '/app', key: 'user-overview', label: '概览' },
  { to: '/app/keys', key: 'user-keys', label: 'API Keys' },
  { to: '/app/usage', key: 'user-usage', label: '用量流水' },
]

const titleMap: Record<string, string> = {
  'user-overview': '仪表盘',
  'user-keys': 'API Keys',
  'user-usage': '用量流水',
}

const subtitleMap: Record<string, string> = {
  'user-overview': '欢迎回来！这是您账户的概览。',
  'user-keys': '管理您的 API Key 和调用入口。',
  'user-usage': '查看请求消耗、账单扣费和钱包流水。',
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
  <div class="flex h-screen overflow-hidden bg-gray-50 dark:bg-dark-950">
    <!-- Mobile overlay -->
    <Transition name="modal-fade">
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
        @click="sidebarOpen = false"
      />
    </Transition>

    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-58 flex-shrink-0 flex-col border-r border-gray-200 bg-white/95 backdrop-blur-xl transition-transform duration-300 ease-out dark:border-dark-800 dark:bg-dark-900/95 lg:static lg:z-auto lg:translate-x-0 lg:bg-white/90 lg:dark:bg-dark-900/90"
      style="width: 232px"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex items-center gap-3 px-5 py-5">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
          <span class="h-3.5 w-3.5 rotate-45 rounded-[4px] bg-white" />
        </span>
        <div class="leading-tight">
          <strong class="block text-[15px] font-bold text-gray-900 dark:text-white">Model Bridge</strong>
          <small class="text-xs text-gray-400 dark:text-dark-400">User Console</small>
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

      <nav class="flex-1 space-y-1 overflow-y-auto px-3 pb-4 pt-2">
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

      <div class="m-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-3.5 dark:border-dark-700 dark:bg-dark-800/60">
        <strong class="block text-[13px] text-gray-900 dark:text-white">{{ auth.username }}</strong>
        <span class="text-xs text-gray-400 dark:text-dark-400">钱包账户</span>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="relative z-[100] flex min-h-[68px] flex-shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white/85 px-4 py-2.5 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/80 sm:px-7"
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
              class="absolute right-0 top-full z-[1000] mt-2 w-56 rounded-xl border border-gray-200 bg-white p-4 text-sm font-medium text-gray-500 shadow-xl dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300"
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
              class="absolute right-0 top-full z-[1000] mt-2 w-40 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-dark-700 dark:bg-dark-800"
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
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
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
              <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary-500 text-xs font-bold text-white shadow-sm">
                {{ avatarInitials }}
              </span>
              <span class="hidden min-w-0 text-left md:block">
                <strong class="block max-w-[180px] truncate text-[13px] font-bold text-gray-900 dark:text-white">
                  {{ displayName }}
                </strong>
                <span class="block text-[11px] font-medium text-gray-500 dark:text-dark-400">User</span>
              </span>
              <svg class="hidden h-5 w-5 flex-shrink-0 text-gray-400 md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              v-if="profileOpen"
              class="absolute right-0 top-full z-[1000] mt-1.5 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-dark-700 dark:bg-dark-800"
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
