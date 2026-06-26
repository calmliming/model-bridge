<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMessage } from '../composables/useMessage'
import {
  CATEGORIES,
  MODEL_CATALOG,
  PROVIDERS,
  type PlazaModel,
  type ProviderId,
} from '../catalog/modelCatalog'

const message = useMessage()

const search = ref('')
const activeCategory = ref<string>('all')
const activeProvider = ref<'all' | ProviderId>('all')
const selected = ref<PlazaModel | null>(null)

const providerList = Object.values(PROVIDERS)

const categoryTabs = [{ key: 'all', label: '全部' }, ...CATEGORIES]
const categoryLabel = (key: string) => CATEGORIES.find((c) => c.key === key)?.label ?? key

const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return MODEL_CATALOG.filter((m) => {
    if (activeCategory.value !== 'all' && !m.categories.includes(activeCategory.value)) return false
    if (activeProvider.value !== 'all' && m.provider !== activeProvider.value) return false
    if (kw) {
      const haystack = `${m.name} ${m.id} ${PROVIDERS[m.provider].label} ${m.tags.join(' ')} ${m.description}`.toLowerCase()
      if (!haystack.includes(kw)) return false
    }
    return true
  })
})

function providerCount(id: ProviderId): number {
  return MODEL_CATALOG.filter((m) => m.provider === id).length
}

function formatPrice(value: number): string {
  return value < 1 ? `$${value.toFixed(2)}` : `$${value % 1 === 0 ? value : value.toFixed(2)}`
}

function badgeLabel(badge: PlazaModel['badge']): string {
  return badge === 'new' ? 'NEW' : '推荐'
}

function callExample(model: PlazaModel): string {
  const base = 'https://your-host'
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
  <div>
    <!-- Filters -->
    <div class="mb-5 space-y-4">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-400">
          <span>共</span>
          <strong class="text-gray-900 dark:text-white">{{ filtered.length }}</strong>
          <span>个模型</span>
        </div>
        <div class="w-full sm:w-72">
          <UiInput v-model:value="search" placeholder="搜索模型名称 / 厂商 / 能力" />
        </div>
      </div>

      <!-- Category tabs -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="cat in categoryTabs"
          :key="cat.key"
          type="button"
          class="rounded-full px-3.5 py-1.5 text-sm font-medium transition-all"
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
      <div class="flex flex-wrap gap-2">
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
    </div>

    <!-- Card grid -->
    <div
      v-if="filtered.length"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      <button
        v-for="model in filtered"
        :key="model.id"
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
            v-for="tag in model.tags"
            :key="tag"
            class="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-dark-800 dark:text-dark-300"
          >
            {{ tag }}
          </span>
        </div>

        <div class="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-dark-800">
          <span class="text-[11px] text-gray-400 dark:text-dark-400">
            上下文 <strong class="text-gray-600 dark:text-dark-200">{{ model.context }}</strong>
          </span>
          <span class="text-[11px] text-gray-400 dark:text-dark-400">
            输入
            <strong class="text-gray-700 dark:text-dark-100">{{ formatPrice(model.inputPrice) }}</strong>
            / 输出
            <strong class="text-gray-700 dark:text-dark-100">{{ formatPrice(model.outputPrice) }}</strong>
            <span class="text-gray-400">/1M</span>
          </span>
        </div>
      </button>
    </div>

    <div
      v-else
      class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-sm text-gray-400 dark:border-dark-700 dark:text-dark-400"
    >
      没有符合条件的模型，试试调整筛选或搜索词。
    </div>

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

        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800">
            <div class="text-[11px] text-gray-400 dark:text-dark-400">上下文窗口</div>
            <div class="mt-1 text-sm font-bold text-gray-900 dark:text-white">{{ selected.context }}</div>
          </div>
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800">
            <div class="text-[11px] text-gray-400 dark:text-dark-400">输入价格 /1M</div>
            <div class="mt-1 text-sm font-bold text-gray-900 dark:text-white">{{ formatPrice(selected.inputPrice) }}</div>
          </div>
          <div class="rounded-xl bg-gray-50 p-3 dark:bg-dark-800">
            <div class="text-[11px] text-gray-400 dark:text-dark-400">输出价格 /1M</div>
            <div class="mt-1 text-sm font-bold text-gray-900 dark:text-white">{{ formatPrice(selected.outputPrice) }}</div>
          </div>
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
          <UiButton @click="selected = null">关闭</UiButton>
        </UiSpace>
      </template>
    </UiModal>
  </div>
</template>
