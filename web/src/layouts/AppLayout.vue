<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import SystemVersionBadge from '../components/SystemVersionBadge.vue'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menuIconPaths = {
  overview: [
    'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  ],
  accounts: [
    'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
  ],
  'account-groups': [
    'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z',
  ],
  keys: [
    'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z',
  ],
  users: [
    'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
  ],
  payments: [
    'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z',
  ],
  'redeem-codes': [
    'M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z',
  ],
  'subscription-plans': [
    'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z',
  ],
  stats: [
    'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  ],
  docs: [
    'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  ],
  settings: [
    'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z',
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  ],
} as const

type MenuIcon = keyof typeof menuIconPaths

const menu: Array<{ to: string; key: string; label: string; icon: MenuIcon }> = [
  { to: '/overview', key: 'overview', label: '仪表盘', icon: 'overview' },
  { to: '/accounts', key: 'accounts', label: '上游账户', icon: 'accounts' },
  { to: '/account-groups', key: 'account-groups', label: '分组管理', icon: 'account-groups' },
  { to: '/keys', key: 'keys', label: 'API Keys', icon: 'keys' },
  { to: '/users', key: 'users', label: '用户钱包', icon: 'users' },
  { to: '/payments', key: 'payments', label: '充值订单', icon: 'payments' },
  { to: '/redeem-codes', key: 'redeem-codes', label: '兑换码', icon: 'redeem-codes' },
  { to: '/subscription-plans', key: 'subscription-plans', label: '订阅套餐', icon: 'subscription-plans' },
  { to: '/stats', key: 'stats', label: '用量统计', icon: 'stats' },
  { to: '/docs', key: 'docs', label: '使用文档', icon: 'docs' },
  { to: '/settings', key: 'settings', label: '设置', icon: 'settings' },
]

const titleMap: Record<string, string> = {
  overview: '仪表盘',
  accounts: '上游账户',
  'account-groups': '分组管理',
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
  'account-groups': '维护账号分组、计费倍率和组内成员权重。',
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
          class="group relative flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all"
          :class="
            activeKey === item.key
              ? 'bg-primary-50 text-primary-600 shadow-sm shadow-primary-500/10 dark:bg-primary-900/20 dark:text-primary-300'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-dark-300 dark:hover:bg-dark-800 dark:hover:text-white'
          "
        >
          <div
            v-if="activeKey === item.key"
            class="absolute left-0 h-5 w-1 rounded-r-full bg-primary-500 transition-all"
          />
          <svg
            class="h-5 w-5 flex-shrink-0 transition-transform group-hover:scale-110"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <path
              v-for="path in menuIconPaths[item.icon]"
              :key="path"
              stroke-linecap="round"
              stroke-linejoin="round"
              :d="path"
            />
          </svg>
          <span class="truncate">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="m-4 flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-dark-700/50 dark:bg-dark-800/60">
        <div class="relative flex h-2.5 w-2.5 items-center justify-center">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75"></span>
          <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary-500"></span>
        </div>
        <div class="leading-tight">
          <strong class="block text-[13px] font-bold text-gray-900 dark:text-white">Relay Ready</strong>
          <span class="text-[11px] font-medium text-gray-400 dark:text-dark-400">控制台在线</span>
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
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
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
