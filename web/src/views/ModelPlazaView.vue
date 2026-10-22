<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useMessage } from '../composables/useMessage'
import { api } from '../api/client'
import {
  CATEGORIES,
  MODEL_CATALOG,
  PROVIDERS,
  resolveModelPrice,
  withAutoSurfacedModels,
  type PlazaModel,
  type ResolvedModelPrice,
  type ProviderId,
  type ModelTokenPrice,
} from '../catalog/modelCatalog'

const message = useMessage()
const route = useRoute()
const isAdmin = computed(() => route.meta.role === 'admin')
const accountCount = ref<number | null>(null)
const sortOrder = ref('default')
const compareIds = ref<string[]>([])
const showCompare = ref(false)

const search = ref('')
const activeCategory = ref<string>('all')
const activeProvider = ref<'all' | ProviderId>('all')
const selected = ref<PlazaModel | null>(null)
const priceClock = ref(Date.now())
const livePrices = ref<Record<string, ModelTokenPrice>>({})
let priceClockTimer: ReturnType<typeof setInterval> | null = null
let stopped = false
async function refreshPrices() {
  try {
    const { data } = await api.get('/auth/model-prices')
    if (stopped) return
    livePrices.value = Object.fromEntries(data.prices.map((price: ModelTokenPrice & { model: string; provider?: string }) => [price.model, price]))
  } catch {
    // Keep the last received catalog; initial offline rendering uses local reference prices.
  }
}

onMounted(() => {
  void refreshPrices()
  if (isAdmin.value) void api.get('/admin/accounts').then(({ data }) => { accountCount.value = data.accounts.length }).catch(() => {})
  priceClockTimer = setInterval(() => {
    priceClock.value = Date.now()
    void refreshPrices()
  }, 30_000)
})

onUnmounted(() => {
  stopped = true
  if (priceClockTimer) clearInterval(priceClockTimer)
})

// Filter by model manufacturer; the supply channel is shown on media cards.
const providerList = Object.values(PROVIDERS)

const categoryTabs = [{ key: 'all', label: '全部' }, ...CATEGORIES]
const categoryLabel = (key: string) => CATEGORIES.find((c) => c.key === key)?.label ?? key

// 静态目录 + 服务端已定价但静态表里没有的模型（上游新发现的）。
const surfaced = computed(() => withAutoSurfacedModels(livePrices.value))
const catalog = computed(() => surfaced.value.catalog)
/** 自动出现的模型 id 集合，用于在卡片上标注来源。 */
const autoSurfaced = computed(() => new Set(surfaced.value.autoSurfacedIds))

const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase()
  const models = catalog.value.filter((m) => {
    if (activeCategory.value !== 'all' && !m.categories.includes(activeCategory.value)) return false
    if (activeProvider.value !== 'all' && m.provider !== activeProvider.value) return false
    if (kw) {
      const haystack = `${m.name} ${m.id} ${PROVIDERS[m.provider].label} ${mediaBillingLabel(m)} ${m.tags.join(' ')} ${m.description}`.toLowerCase()
      if (!haystack.includes(kw)) return false
    }
    return true
  })
  if (sortOrder.value === 'name') models.sort((a, b) => a.name.localeCompare(b.name))
  if (sortOrder.value === 'price') models.sort((a, b) => billingGroup(a) - billingGroup(b) || startingPrice(a) - startingPrice(b))
  return models
})

const compareModels = computed(() => catalog.value.filter(model => compareIds.value.includes(`${model.provider}:${model.id}`)))
const billingGroup = (model: PlazaModel) => model.video ? 2 : model.imageRequestPrice != null ? 1 : 0
function startingPrice(model: PlazaModel) {
  const price = currentPrice(model)
  return model.video ? price.videoSecond480Price ?? 0 : model.imageRequestPrice != null ? price.imageRequestPrice ?? 0 : price.inputPrice
}
function priceSummary(model: PlazaModel) {
  const price = currentPrice(model)
  if (model.video) return `${formatPrice(price.videoSecond480Price ?? 0)} / 秒起（480p）`
  if (model.imageRequestPrice != null) return `${formatPrice(price.imageRequestPrice ?? 0)} / 次`
  return `输入 ${formatPrice(price.inputPrice)} · 输出 ${formatPrice(price.outputPrice)} / 百万 Tokens`
}
function toggleCompare(model: PlazaModel) {
  const id = `${model.provider}:${model.id}`
  if (compareIds.value.includes(id)) compareIds.value = compareIds.value.filter(value => value !== id)
  else if (compareIds.value.length < 3) compareIds.value.push(id)
  else message.info('最多同时对比 3 个模型，请先移除一个。')
}

function providerCount(id: ProviderId): number {
  return catalog.value.filter((m) => m.provider === id).length
}

function formatPrice(value: number): string {
  const digits = value < 0.01 ? 6 : value < 1 ? 3 : 2
  return `$${value.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')}`
}

function currentPrice(model: PlazaModel): ResolvedModelPrice {
  const fallback = resolveModelPrice(model, priceClock.value)
  const live = livePrices.value[model.id]
  if (!live) return fallback
  return { ...live, period: live.inputPrice === fallback.inputPrice && live.outputPrice === fallback.outputPrice
    ? fallback.period : null }
}

function pricePeriodLabel(period: ResolvedModelPrice['period']): string {
  if (period === 'peak') return '高峰'
  if (period === 'off-peak') return '低峰'
  return ''
}

function badgeLabel(badge: PlazaModel['badge']): string {
  return badge === 'new' ? 'NEW' : '推荐'
}

function mediaBillingLabel(model: PlazaModel): string {
  if (model.channel === 'modelbridge') return `Model Bridge · ${model.video ? '按秒计费' : '按次计费'}`
  return ''
}

function callExample(model: PlazaModel): string {
  const base = window.location.origin
  if ((model.imageRequestPrice != null || model.video)) {
    const body = model.video ? { model: model.id, prompt: '电影镜头：橘猫走过雨后的花园，镜头缓慢推进', aspectRatio: 'landscape', resolution: '480p', duration: 5 }
      : { model: model.id, prompt: '一只在窗边看雨的橘猫', size: '1024x1024', response_format: 'url' }
    const path = model.video ? 'videos' : 'images/generations'
    return `curl ${base}/api/media/v1/${path} \\\n  -H "Authorization: Bearer mb-xxxxxxxx" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'${model.video ? '\n\n# 使用返回的 id 查询结果\ncurl ' + base + '/api/media/v1/videos/media_TASK_ID \\\n  -H "Authorization: Bearer mb-xxxxxxxx"' : ''}`
  }
  if (model.image) return `curl ${base}/v1/images/generations \\\n  -H "Authorization: Bearer mb-xxxxxxxx" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: model.id, prompt: '一只在窗边看雨的橘猫', quality: 'high', size: '1024x1024' }, null, 2)}'`
  if (model.provider === 'claude') {
    return [
      `curl ${base}/v1/messages \\`,
      `  -H "Authorization: Bearer mb-xxxxxxxx" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{`,
      `    "model": "${model.id}",`,
      `    "max_tokens": 1024,`,
      `    "messages": [{"role": "user", "content": "你好"}]`,
      `  }'`,
    ].join('\n')
  }
  const prefix =
    model.provider === 'deepseek'
      ? '/api/deepseek/v1'
      : model.provider === 'xiaomi'
        ? '/api/xiaomi/v1'
        : '/v1'
  return [
    `curl ${base}${prefix}/chat/completions \\`,
    `  -H "Authorization: Bearer mb-xxxxxxxx" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "model": "${model.id}",`,
    `    "messages": [{"role": "user", "content": "你好"}]`,
    `  }'`,
  ].join('\n')
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  } catch {
    message.error('复制失败，请手动选择文本')
  }
}

function openDetail(model: PlazaModel) {
  selected.value = model
}
</script>

<template>
  <div class="min-w-0">
    <!-- Filters -->
    <div class="mb-5 space-y-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-400">
          <span>共</span>
          <strong class="text-gray-900 dark:text-white">{{ filtered.length }}</strong>
          <span>个收录模型</span>
        </div>
        <div class="w-full sm:w-72">
          <UiInput v-model:value="search" placeholder="搜索模型名称 / 分类 / 能力" />
        </div>
      </div>

      <!-- Category tabs -->
      <div class="flex max-w-full gap-2 overflow-x-auto pb-1 sm:flex-wrap">
        <button
          v-for="cat in categoryTabs"
          :key="cat.key"
          type="button"
          class="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all"
          :aria-pressed="activeCategory === cat.key"
          :class="
            activeCategory === cat.key
              ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/30'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-dark-800 dark:text-dark-300 dark:hover:bg-dark-700'
          "
          @click="activeCategory = cat.key"
        >
          {{ cat.label }}
        </button>
      </div>

      <!-- Provider filter -->
      <div class="hidden flex-wrap gap-2 sm:flex">
        <button
          type="button"
          class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-all"
          :class="
            activeProvider === 'all'
              ? 'border-primary-400 bg-primary-50 text-primary-600 dark:border-primary-500/40 dark:bg-primary-900/20 dark:text-primary-300'
              : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-dark-700 dark:text-dark-400 dark:hover:border-dark-600'
          "
          @click="activeProvider = 'all'"
        >
          全部厂商
        </button>
        <button
          v-for="p in providerList"
          :key="p.id"
          type="button"
          class="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all"
          :class="
            activeProvider === p.id
              ? 'border-primary-400 bg-primary-50 text-primary-600 dark:border-primary-500/40 dark:bg-primary-900/20 dark:text-primary-300'
              : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-dark-700 dark:text-dark-400 dark:hover:border-dark-600'
          "
          @click="activeProvider = p.id"
        >
          <span
            class="flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold"
            :class="p.chipClass"
          >
            {{ p.initials }}
          </span>
          {{ p.label }}
          <span class="text-gray-400 dark:text-dark-500">{{ providerCount(p.id) }}</span>
        </button>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <label class="min-w-0 flex-1 sm:hidden"><span class="field-label text-xs">厂商</span><select v-model="activeProvider" class="input" aria-label="模型厂商"><option value="all">全部厂商</option><option v-for="provider in providerList" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select></label>
        <label class="min-w-0 flex-1 sm:max-w-60"><span class="field-label text-xs">排序</span><select v-model="sortOrder" class="input" aria-label="模型排序"><option value="default">默认顺序</option><option value="price">起价升序（同单位）</option><option value="name">模型名称</option></select></label>
        <div v-if="isAdmin" class="flex flex-wrap gap-3 text-sm text-primary-700"><span v-if="accountCount != null" class="text-gray-500">已接入 {{ accountCount }} 个账号</span><RouterLink to="/model-catalog" class="hover:underline">动态模型</RouterLink><RouterLink to="/accounts" class="hover:underline">上游账户</RouterLink></div>
      </div>
      <p class="text-xs leading-5 text-gray-500">这里展示模型目录与基础价格；实际可调用范围由 API Key 权限、账号池和额度决定。</p>
      <div v-if="compareModels.length" class="flex flex-wrap items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 p-3 text-sm dark:border-primary-800 dark:bg-primary-900/20"><span>待对比：{{ compareModels.map(model => model.name).join('、') }}</span><UiButton size="small" type="primary" :disabled="compareModels.length < 2" @click="showCompare = true">对比模型（{{ compareModels.length }}）</UiButton><UiButton size="small" quaternary @click="compareIds = []">清空</UiButton></div>
    </div>

    <!-- Card grid -->
    <div
      v-if="filtered.length"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <button
        v-for="model in filtered"
        :key="`${model.provider}:${model.id}`"
        type="button"
        class="group flex flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md dark:border-dark-700 dark:bg-dark-900 dark:hover:border-primary-500/40"
        @click="openDetail(model)"
      >
        <div class="flex items-start gap-3">
          <span
            class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold"
            :class="PROVIDERS[model.provider].chipClass"
          >
            {{ PROVIDERS[model.provider].initials }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <strong class="truncate text-[15px] font-bold text-gray-900 dark:text-white">
                {{ model.name }}
              </strong>
              <span
                v-if="model.badge"
                class="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
                :class="
                  model.badge === 'new'
                    ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
                    : 'bg-primary-100 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300'
                "
              >
                {{ badgeLabel(model.badge) }}
              </span>
            </div>
            <span class="block truncate text-xs text-gray-400 dark:text-dark-400">
              {{ PROVIDERS[model.provider].label }} · {{ model.id }}
            </span>
          </div>
        </div>

        <p class="mt-3 line-clamp-2 min-h-[2.5rem] text-[13px] leading-relaxed text-gray-500 dark:text-dark-300">
          {{ model.description }}
        </p>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <span
            v-if="mediaBillingLabel(model)"
            class="rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-600 dark:bg-primary-500/10 dark:text-primary-300"
          >
            {{ mediaBillingLabel(model) }}
          </span>
          <span
            v-for="tag in model.tags"
            :key="tag"
            class="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-dark-800 dark:text-dark-300"
          >
            {{ tag }}
          </span>
        </div>

        <div class="model-card-price mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-dark-800">
          <span class="text-[11px] text-gray-400 dark:text-dark-400">
            {{ model.video ? '时长' : model.image ? '输出边长' : '上下文' }} <strong class="text-gray-600 dark:text-dark-200">{{ model.context }}</strong>
          </span>
          <span v-if="(model.imageRequestPrice != null || model.video)" class="text-[11px] text-gray-400 dark:text-dark-400">
            <strong class="text-gray-700 dark:text-dark-100">{{ formatPrice(model.video ? currentPrice(model).videoSecond480Price ?? 0 : currentPrice(model).imageRequestPrice ?? 0) }}</strong>
            {{ model.video ? '/ 秒起' : '/ 次' }}
          </span>
          <span v-else class="text-[11px] text-gray-400 dark:text-dark-400">
            {{ model.image ? '文本输入' : '输入' }}
            <strong class="text-gray-700 dark:text-dark-100">{{ formatPrice(currentPrice(model).inputPrice) }}</strong>
            / {{ model.image ? '图片输出' : '输出' }}
            <strong class="text-gray-700 dark:text-dark-100">{{ formatPrice(model.image ? currentPrice(model).imageOutputPrice ?? 30 : currentPrice(model).outputPrice) }}</strong>
            <span class="text-gray-400">/1M</span>
            <span v-if="currentPrice(model).period" class="ml-1 text-primary-500">
              {{ pricePeriodLabel(currentPrice(model).period) }}
            </span>
          </span>
        </div>
      </button>
    </div>

    <div
      v-else
      class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-sm text-gray-400 dark:border-dark-700 dark:text-dark-400"
    >
      没有符合条件的模型，试试调整筛选或搜索词。
      <UiButton class="mt-3" secondary @click="search = ''; activeCategory = 'all'; activeProvider = 'all'">清空筛选</UiButton>
    </div>

    <UiModal v-model:show="showCompare" title="模型对比" :width="900">
      <p class="mb-4 text-sm text-gray-500">按每个模型标注的单位比较价格；按次、按秒和 Token 计费不能直接等同。</p>
      <div class="grid gap-4" :class="compareModels.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'">
        <article v-for="model in compareModels" :key="`${model.provider}:${model.id}`" class="min-w-0 rounded-xl border border-gray-200 p-4 dark:border-dark-700"><h3 class="break-words font-semibold">{{ model.name }}</h3><p class="mt-2 text-xs text-gray-500">{{ PROVIDERS[model.provider].label }}</p><dl class="mt-4 space-y-4 text-sm"><div><dt class="text-xs text-gray-500">{{ model.video ? '时长' : model.image ? '输出尺寸' : '上下文' }}</dt><dd class="mt-1">{{ model.context }}</dd></div><div><dt class="text-xs text-gray-500">基础价格</dt><dd class="mt-1 break-words font-semibold">{{ priceSummary(model) }}</dd></div><div><dt class="text-xs text-gray-500">能力标签</dt><dd class="mt-1 break-words">{{ model.tags.join('、') }}</dd></div></dl><UiButton class="mt-4" size="small" quaternary @click="toggleCompare(model)">移出对比</UiButton></article>
      </div>
    </UiModal>

    <!-- Detail modal -->
    <UiModal
      :show="!!selected"
      :title="selected?.name ?? ''"
      :width="560"
      @update:show="(v: boolean) => { if (!v) selected = null }"
    >
      <div v-if="selected" class="space-y-5">
        <div class="flex items-start gap-3">
          <span
            class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-base font-bold"
            :class="PROVIDERS[selected.provider].chipClass"
          >
            {{ PROVIDERS[selected.provider].initials }}
          </span>
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-500 dark:text-dark-300">
              {{ PROVIDERS[selected.provider].label }}
            </div>
            <code class="text-xs text-gray-400 dark:text-dark-400">{{ selected.id }}</code>
          </div>
        </div>

        <p class="text-sm leading-relaxed text-gray-600 dark:text-dark-200">
          {{ selected.description }}
        </p>

        <div class="flex flex-wrap gap-1.5">
          <UiTag v-if="mediaBillingLabel(selected)" size="small" type="primary" :bordered="false">
            {{ mediaBillingLabel(selected) }}
          </UiTag>
          <UiTag
            v-for="cat in selected.categories"
            :key="cat"
            size="small"
            type="primary"
            :bordered="false"
          >
            {{ categoryLabel(cat) }}
          </UiTag>
          <UiTag
            v-for="tag in selected.tags"
            :key="tag"
            size="small"
            :bordered="false"
          >
            {{ tag }}
          </UiTag>
        </div>

        <div v-if="(selected.imageRequestPrice != null || selected.video)" class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <template v-if="selected.video">
            <div v-for="tier in [{ label: '480p', price: currentPrice(selected).videoSecond480Price }, { label: '768p', price: currentPrice(selected).videoSecond768Price }, { label: '1080p', price: currentPrice(selected).videoSecond1080Price }]" :key="tier.label" class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800">
              <div class="text-[11px] text-gray-400">{{ tier.label }} / 秒</div><div class="mt-1 text-sm font-bold">{{ formatPrice(tier.price ?? 0) }}</div>
            </div>
          </template>
          <div v-else class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800"><div class="text-[11px] text-gray-400">成功生成 / 次</div><div class="mt-1 text-sm font-bold">{{ formatPrice(currentPrice(selected).imageRequestPrice ?? 0) }}</div></div>
        </div>
        <div v-else
          class="grid grid-cols-2 gap-3"
          :class="currentPrice(selected).cacheReadPrice == null ? 'sm:grid-cols-3' : 'sm:grid-cols-4'"
        >
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800">
            <div class="text-[11px] text-gray-400 dark:text-dark-400">{{ selected.image ? '输出边长' : '上下文窗口' }}</div>
            <div class="mt-1 text-sm font-bold text-gray-900 dark:text-white">{{ selected.context }}</div>
          </div>
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800">
            <div class="text-[11px] text-gray-400 dark:text-dark-400">
              {{ selected.image ? '文本输入' : '输入价格' }} /1M
              <span v-if="currentPrice(selected).period">· {{ pricePeriodLabel(currentPrice(selected).period) }}</span>
            </div>
            <div class="mt-1 text-sm font-bold text-gray-900 dark:text-white">{{ formatPrice(currentPrice(selected).inputPrice) }}</div>
          </div>
          <div v-if="currentPrice(selected).cacheReadPrice != null" class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800">
            <div class="text-[11px] text-gray-400 dark:text-dark-400">{{ selected.image ? '文本缓存' : '缓存命中' }} /1M</div>
            <div class="mt-1 text-sm font-bold text-gray-900 dark:text-white">{{ formatPrice(currentPrice(selected).cacheReadPrice ?? 0) }}</div>
          </div>
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800">
            <div class="text-[11px] text-gray-400 dark:text-dark-400">{{ selected.image ? '图片输出' : '输出价格' }} /1M</div>
            <div class="mt-1 text-sm font-bold text-gray-900 dark:text-white">{{ formatPrice(selected.image ? currentPrice(selected).imageOutputPrice ?? 30 : currentPrice(selected).outputPrice) }}</div>
          </div>
          <template v-if="selected.image">
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800"><div class="text-[11px] text-gray-400">图片输入 /1M</div><div class="mt-1 text-sm font-bold">{{ formatPrice(currentPrice(selected).imageInputPrice ?? 8) }}</div></div>
            <div class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800"><div class="text-[11px] text-gray-400">图片缓存 /1M</div><div class="mt-1 text-sm font-bold">{{ formatPrice(currentPrice(selected).imageCacheReadPrice ?? 2) }}</div></div>
          </template>
        </div>

        <div>
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-semibold text-gray-700 dark:text-dark-200">调用示例</span>
            <UiButton size="small" secondary @click="copy(callExample(selected))">复制</UiButton>
          </div>
          <pre class="overflow-x-auto rounded-xl bg-gray-900 p-3.5 text-xs leading-relaxed text-gray-100 dark:bg-black/40"><code>{{ callExample(selected) }}</code></pre>
        </div>
      </div>
      <template #footer>
        <UiSpace justify="end">
          <RouterLink to="/docs/api" class="btn btn-secondary">API 文档</RouterLink>
          <UiButton v-if="selected" secondary @click="toggleCompare(selected)">{{ compareIds.includes(`${selected.provider}:${selected.id}`) ? '移出对比' : '加入对比' }}</UiButton>
          <UiButton @click="selected = null">关闭</UiButton>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.model-card-price > span { font-size: 12px; color: #64748b; }
.model-card-price strong { font-size: 14px; }
</style>
