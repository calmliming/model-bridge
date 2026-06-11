<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'

const auth = useAuthStore()
const scrolled = ref(false)
const activeTab = ref('curl')

const systemSummary = ref<{
  registrationEnabled: boolean
  accounts: number
  requests: number
  providers: string[]
} | null>(null)

onMounted(async () => {
  window.addEventListener('scroll', () => {
    scrolled.value = window.scrollY > 20
  })

  try {
    const { data } = await api.get('/auth/system-summary')
    systemSummary.value = data
  } catch {
    // Ignore error
  }
})

const features = [
  {
    title: '统一模型接口',
    desc: '完美兼容 OpenAI 接口规范，通过单一地址即可访问 GPT, Claude, Gemini, DeepSeek 等数十种顶级大模型。',
    icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
  },
  {
    title: '智能调度与容灾',
    desc: '基于权重的负载均衡与实时健康检查，当某个账号或渠道不可用时，系统会自动平滑切换到可用资源。',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
  },
  {
    title: '精细化配额控制',
    desc: '按分钟/小时/天设置精细的配额窗口，支持自动刷新 Session 和用量自动停调，确保资源利用最大化。',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
  },
  {
    title: '企业级统计看板',
    desc: '多维度流量统计、成本分析与异常日志监控。支持模型、用户、Key 等多维度的实时消耗明细查询。',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
  }
]

const codeSnippets = {
  curl: `curl https://api.model-bridge.io/v1/chat/completions \\
  -H "Authorization: Bearer $MB_KEY" \\
  -d '{
    "model": "gpt-5.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
  python: `import openai

client = openai.OpenAI(
    base_url="https://api.model-bridge.io/v1",
    api_key="your-mb-api-key"
)

response = client.chat.completions.create(
    model="claude-opus-4-8",
    messages=[{"role": "user", "content": "Hello!"}]
)`,
  js: `const OpenAI = require('openai');
const openai = new OpenAI({
  baseURL: 'https://api.model-bridge.io/v1',
  apiKey: 'your-mb-api-key',
});`
}
</script>

<template>
  <div class="min-h-screen bg-white text-slate-900 selection:bg-primary-500/20 dark:bg-dark-950 dark:text-white">
    <!-- Simple Navbar -->
    <nav
      class="fixed inset-x-0 top-0 z-50 border-b transition-all duration-300"
      :class="scrolled ? 'bg-white/90 backdrop-blur-md border-slate-200 dark:bg-dark-900/90 dark:border-dark-800' : 'bg-transparent border-transparent'"
    >
      <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div class="flex items-center gap-3">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600 shadow-md">
            <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          <span class="text-xl font-bold tracking-tight">Model Bridge</span>
        </div>
        
        <div class="hidden md:flex items-center gap-10">
          <a href="#features" class="text-sm font-medium text-slate-600 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-400 transition-colors">核心功能</a>
          <RouterLink :to="{ name: 'docs' }" class="text-sm font-medium text-slate-600 hover:text-primary-600 dark:text-slate-400 dark:hover:text-primary-400 transition-colors">文档</RouterLink>
        </div>

        <div class="flex items-center gap-4">
          <RouterLink
            v-if="!auth.isAuthenticated"
            :to="{ name: 'login' }"
            class="text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
          >
            登录
          </RouterLink>
          <RouterLink
            :to="auth.isAuthenticated ? (auth.isAdmin ? '/overview' : '/app') : { name: 'login' }"
            class="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-700 transition-all active:scale-95"
          >
            {{ auth.isAuthenticated ? '进入控制台' : '立即开始' }}
          </RouterLink>
        </div>
      </div>
    </nav>

    <!-- Hero Section -->
    <section class="relative pt-32 pb-20 sm:pt-48 sm:pb-32 overflow-hidden bg-slate-50 dark:bg-dark-900 text-center lg:text-left">
      <div class="mx-auto max-w-7xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div class="animate-in fade-in slide-in-from-left-4 duration-1000">
          <div class="inline-flex items-center rounded-full bg-primary-50 px-4 py-1 text-sm font-bold text-primary-700 dark:bg-primary-950/30 dark:text-primary-400 mb-6">
            {{ systemSummary?.providers.length ?? '10+' }} 个顶级 AI 服务商已接入
          </div>
          <h1 class="text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-7xl leading-tight">
            更稳定、更智能、<br />
            <span class="text-primary-600">更懂开发者的中转。</span>
          </h1>
          <p class="mt-8 text-xl text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl mx-auto lg:mx-0">
            Model Bridge 将 {{ systemSummary?.accounts ?? '数十' }} 个上游账户聚合为单一入口。累计已稳定处理 {{ systemSummary ? (systemSummary.requests / 10000).toFixed(1) : '数万' }} 万次 API 调用。
          </p>
          <div class="mt-12 flex flex-wrap justify-center lg:justify-start gap-5">
            <RouterLink
              :to="auth.isAuthenticated ? (auth.isAdmin ? '/overview' : '/app') : { name: 'login' }"
              class="rounded-xl bg-slate-900 px-8 py-4 text-lg font-bold text-white shadow-xl hover:bg-slate-800 transition-all dark:bg-primary-600 dark:hover:bg-primary-700"
            >
              {{ auth.isAuthenticated ? '进入管理后台' : '立即开始构建' }}
            </RouterLink>
            <a href="https://github.com/calmliming/model-bridge" target="_blank" class="rounded-xl bg-white border border-slate-200 px-8 py-4 text-lg font-bold text-slate-900 shadow-sm hover:bg-slate-50 transition-all dark:bg-dark-800 dark:border-dark-700 dark:text-white">
              GitHub 源码
            </a>
          </div>
        </div>
        <div class="relative animate-in fade-in zoom-in-95 duration-1000 delay-200">
          <div class="rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-dark-700 dark:bg-dark-800">
            <div class="bg-slate-50 dark:bg-dark-950 rounded-xl overflow-hidden">
              <div class="flex items-center gap-2 px-5 py-3 border-b dark:border-dark-800">
                <div class="flex gap-1.5">
                  <div class="h-3 w-3 rounded-full bg-red-400"></div>
                  <div class="h-3 w-3 rounded-full bg-yellow-400"></div>
                  <div class="h-3 w-3 rounded-full bg-green-400"></div>
                </div>
                <div class="mx-auto text-[11px] font-bold text-slate-400 uppercase tracking-widest">Analytics Dashboard</div>
              </div>
              <div class="p-8">
                <div class="grid grid-cols-2 gap-6 mb-8">
                  <div class="h-24 rounded-xl bg-white dark:bg-dark-900 border border-slate-100 dark:border-dark-800 p-4">
                    <div class="h-3 w-1/2 rounded bg-slate-100 dark:bg-dark-800"></div>
                    <div class="mt-4 h-6 w-3/4 rounded bg-primary-100 dark:bg-primary-900/30"></div>
                  </div>
                  <div class="h-24 rounded-xl bg-white dark:bg-dark-900 border border-slate-100 dark:border-dark-800 p-4">
                    <div class="h-3 w-1/2 rounded bg-slate-100 dark:bg-dark-800"></div>
                    <div class="mt-4 h-6 w-3/4 rounded bg-purple-100 dark:bg-purple-900/30"></div>
                  </div>
                </div>
                <div class="h-40 rounded-xl bg-white dark:bg-dark-900 border border-slate-100 dark:border-dark-800 p-4 flex items-end justify-between gap-2">
                  <div v-for="i in 10" :key="i" class="w-full bg-primary-500/20 dark:bg-primary-500/40 rounded-t-lg" :style="`height: ${Math.random() * 80 + 20}%` "></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features Section -->
    <section id="features" class="py-24 sm:py-32">
      <div class="mx-auto max-w-7xl px-6">
        <div class="text-center mb-20">
          <h2 class="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">核心特性</h2>
          <p class="mt-4 text-lg text-slate-600 dark:text-slate-400">稳定高效的调度算法与完备的商业化方案，助您构建顶尖 AI 应用。</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div v-for="f in features" :key="f.title" class="group rounded-2xl border border-slate-100 bg-white p-8 shadow-sm transition-all hover:border-primary-500/30 hover:shadow-xl dark:border-dark-800 dark:bg-dark-900">
            <div class="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/30 dark:text-primary-400 transition-transform group-hover:scale-110">
              <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="f.icon" />
              </svg>
            </div>
            <h3 class="text-xl font-bold text-slate-900 dark:text-white">{{ f.title }}</h3>
            <p class="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {{ f.desc }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Integration Section -->
    <section class="bg-slate-50 dark:bg-dark-900 py-24 sm:py-32 overflow-hidden">
      <div class="mx-auto max-w-7xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
        <div class="relative">
          <div class="absolute -inset-2 rounded-3xl bg-primary-600/5 blur-2xl"></div>
          <div class="relative overflow-hidden rounded-2xl bg-slate-950 shadow-2xl border border-white/10">
            <div class="flex items-center gap-2 border-b border-white/5 bg-white/5 px-6 py-4">
              <button v-for="t in ['curl', 'python', 'js']" :key="t" @click="activeTab = t" :class="activeTab === t ? 'text-white' : 'text-white/40 hover:text-white/60'" class="text-xs font-bold uppercase tracking-widest px-3 transition-colors">
                {{ t }}
              </button>
            </div>
            <pre class="p-8 text-sm leading-relaxed text-blue-300 font-mono overflow-x-auto"><code>{{ codeSnippets[activeTab] }}</code></pre>
          </div>
        </div>
        <div class="text-left">
          <h2 class="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">无缝平替</h2>
          <p class="mt-6 text-lg leading-relaxed text-slate-600 dark:text-slate-400">
            完全兼容 OpenAI API 协议，只需更改 API 地址即可无缝迁移。无论您使用的是官方 SDK 还是开源组件库，都能直接上手。
          </p>
          <ul class="mt-10 space-y-4">
            <li v-for="item in ['支持实时流式输出 (Stream)', '内置高并发优化架构', '多级分组计费策略支持']" :key="item" class="flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              <svg class="h-5 w-5 text-primary-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
              {{ item }}
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Simple Footer -->
    <footer class="border-t border-slate-100 dark:border-dark-800 py-16">
      <div class="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-10">
        <div class="flex items-center gap-3">
          <span class="text-primary-600">
            <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          <span class="text-2xl font-black tracking-tighter uppercase">Model Bridge</span>
        </div>
        <p class="text-sm font-medium text-slate-400 dark:text-dark-500">© 2026 Model Bridge Protocol. Open source infrastructure.</p>
        <div class="flex gap-8">
          <a href="https://github.com/calmliming/model-bridge" target="_blank" class="text-sm font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">GitHub</a>
          <a href="#" class="text-sm font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Twitter</a>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slide-in-from-left {
  from { transform: translateX(-1rem); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes zoom-in-95 {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.animate-in {
  animation-duration: 0.6s;
  animation-fill-mode: both;
}
.fade-in { animation-name: fade-in; }
.slide-in-from-left-4 { animation-name: slide-in-from-left; }
.zoom-in-95 { animation-name: zoom-in-95; }

.delay-200 { animation-delay: 200ms; }
</style>
