<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    page?: number
    pageSize?: number
    itemCount?: number
    disabled?: boolean
  }>(),
  { page: 1, pageSize: 10, itemCount: 0 },
)

const emit = defineEmits<{ (e: 'update:page', v: number): void }>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.itemCount / props.pageSize)))
const jumpPage = ref('')

// Compact page window around the current page.
const pages = computed(() => {
  const total = pageCount.value
  const cur = props.page
  const out: (number | '...')[] = []
  const add = (n: number | '...') => out.push(n)
  if (total <= 7) {
    for (let i = 1; i <= total; i++) add(i)
  } else {
    add(1)
    if (cur > 3) add('...')
    for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++) add(i)
    if (cur < total - 2) add('...')
    add(total)
  }
  return out
})

function go(p: number) {
  if (props.disabled) return
  if (p < 1 || p > pageCount.value || p === props.page) return
  emit('update:page', p)
}

function jump() {
  if (props.disabled || !jumpPage.value.trim()) return
  const next = Math.max(1, Math.min(pageCount.value, Math.floor(Number(jumpPage.value))))
  if (!Number.isFinite(next)) return
  go(next)
  jumpPage.value = ''
}

watch(
  () => props.page,
  () => {
    jumpPage.value = ''
  },
)
</script>

<template>
  <div class="flex flex-wrap items-center justify-end gap-1.5" :class="disabled && 'pointer-events-none opacity-50'">
    <button class="pg-btn" :disabled="page <= 1" @click="go(page - 1)">
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
      </svg>
    </button>
    <template v-for="(p, i) in pages" :key="i">
      <span v-if="p === '...'" class="px-1 text-sm text-gray-400">…</span>
      <button
        v-else
        class="pg-btn"
        :class="p === page && 'is-active'"
        @click="go(p as number)"
      >
        {{ p }}
      </button>
    </template>
    <button class="pg-btn" :disabled="page >= pageCount" @click="go(page + 1)">
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
      </svg>
    </button>
    <label class="pg-jump">
      <span>跳至</span>
      <input
        v-model="jumpPage"
        class="pg-jump-input"
        type="number"
        inputmode="numeric"
        min="1"
        :max="pageCount"
        :disabled="disabled"
        @keyup.enter="jump"
        @blur="jump"
      />
      <span>页</span>
    </label>
  </div>
</template>

<style scoped>
.pg-btn {
  @apply flex h-8 min-w-[2rem] items-center justify-center rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-dark-600 dark:bg-dark-800 dark:text-gray-300 dark:hover:bg-dark-700;
}

.pg-btn.is-active {
  @apply border-primary-500 bg-primary-500 text-white shadow-sm hover:border-primary-500 hover:bg-primary-500;
}

.pg-jump {
  @apply ml-2 inline-flex h-8 items-center gap-1.5 whitespace-nowrap text-xs font-medium text-gray-500 dark:text-dark-300;
}

.pg-jump-input {
  @apply h-8 w-14 rounded-lg border border-gray-200 bg-white px-2 text-center text-sm font-semibold text-gray-700 outline-none transition-colors focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed dark:border-dark-600 dark:bg-dark-800 dark:text-gray-200;
}
</style>
