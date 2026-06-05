<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const menu = [
  { to: '/app', key: 'user-overview', label: '概览' },
  { to: '/app/keys', key: 'user-keys', label: 'API Keys' },
  { to: '/app/usage', key: 'user-usage', label: '用量流水' },
]

const titleMap: Record<string, string> = {
  'user-overview': '用户概览',
  'user-keys': 'API Keys',
  'user-usage': '用量流水',
}

const activeKey = computed(() => route.name as string)
const pageTitle = computed(() => titleMap[activeKey.value] ?? '用户中心')

function logout() {
  auth.clear()
  void router.push({ name: 'user-login' })
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-gray-50 dark:bg-dark-950">
    <aside
      class="flex w-58 flex-shrink-0 flex-col border-r border-gray-200 bg-white/90 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/90"
      style="width: 232px"
    >
      <div class="flex items-center gap-3 px-5 py-5">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-primary shadow-glow">
          <span class="h-3.5 w-3.5 rotate-45 rounded-[4px] bg-white" />
        </span>
        <div class="leading-tight">
          <strong class="block text-[15px] font-bold text-gray-900 dark:text-white">Model Bridge</strong>
          <small class="text-xs text-gray-400 dark:text-dark-400">User Console</small>
        </div>
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
        class="flex h-[68px] flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white/80 px-7 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/80"
      >
        <h1 class="text-lg font-bold text-gray-900 dark:text-white">{{ pageTitle }}</h1>
        <button class="btn btn-secondary btn-sm" @click="logout">退出登录</button>
      </header>
      <main class="min-w-0 flex-1 overflow-y-auto p-7">
        <router-view />
      </main>
    </div>
  </div>
</template>
