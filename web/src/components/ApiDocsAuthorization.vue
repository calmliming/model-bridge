<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMessage } from '../composables/useMessage'

const STORAGE_KEY = 'mb_api_docs_api_key'

const props = defineProps<{ apiKey: string }>()
const emit = defineEmits<{ (event: 'update:apiKey', value: string): void }>()
const message = useMessage()

const dialogOpen = ref(false)
const draftKey = ref('')
const keyVisible = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

const hasAuthorization = computed(() => !!props.apiKey.trim())
const draftMatchesSaved = computed(() =>
  !!draftKey.value.trim() && draftKey.value.trim() === props.apiKey.trim(),
)

const maskedKey = computed(() => {
  const key = props.apiKey.trim()
  if (!key) return '配置 API Key'
  if (key.length <= 8) return `${key.slice(0, 2)}••••${key.slice(-2)}`
  return `${key.slice(0, Math.min(6, key.length - 4))}••••••${key.slice(-4)}`
})

function readStoredKey(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

function open(): void {
  draftKey.value = props.apiKey
  keyVisible.value = false
  dialogOpen.value = true
  void nextTick(() => inputRef.value?.focus())
}

function close(): void {
  dialogOpen.value = false
  keyVisible.value = false
}

function save(): void {
  const key = draftKey.value.trim()
  if (!key) {
    message.error('请输入 API Key')
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, key)
  } catch {
    message.error('浏览器阻止了本地存储，无法保存授权')
    return
  }
  emit('update:apiKey', key)
  message.success('API Key 已保存到当前浏览器')
}

function clear(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Clearing the in-memory value still revokes this page's authorization.
  }
  draftKey.value = ''
  emit('update:apiKey', '')
  message.success('API Key 已清除')
  void nextTick(() => inputRef.value?.focus())
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && dialogOpen.value) close()
}

watch(() => props.apiKey, (value) => {
  if (!dialogOpen.value) draftKey.value = value
})

onMounted(() => {
  const storedKey = readStoredKey()
  if (storedKey && !props.apiKey) emit('update:apiKey', storedKey)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

defineExpose({ open })
</script>

<template>
  <div class="authorization-control">
    <button
      type="button"
      class="authorization-trigger"
      :class="hasAuthorization && 'authorization-trigger-active'"
      :aria-label="hasAuthorization ? `已授权，当前 Key ${maskedKey}` : '配置 API Key'"
      :title="hasAuthorization ? '查看或更换 API Key' : '配置 API Key'"
      @click="open"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.03 5.91c-.56-.1-1.16.03-1.56.43l-2.66 2.66H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5A6 6 0 1121.75 8.25z" />
      </svg>
      <span>{{ maskedKey }}</span>
      <i v-if="hasAuthorization" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="dialogOpen" class="authorization-backdrop" @click.self="close">
          <section class="authorization-dialog" role="dialog" aria-modal="true" aria-labelledby="authorization-title">
            <header>
              <span class="dialog-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5A2.25 2.25 0 0119.5 12.75v6A2.25 2.25 0 0117.25 21H6.75a2.25 2.25 0 01-2.25-2.25v-6a2.25 2.25 0 012.25-2.25z" />
                </svg>
              </span>
              <div>
                <h2 id="authorization-title">API 授权</h2>
                <p>保存后用于所有接口的在线调试，仅存储在当前浏览器。</p>
              </div>
              <button type="button" class="dialog-close" aria-label="关闭授权窗口" @click="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <div class="dialog-body">
              <label for="api-docs-key">API Key（Bearer Token）</label>
              <div class="key-input-group">
                <span>Bearer</span>
                <input
                  id="api-docs-key"
                  ref="inputRef"
                  v-model="draftKey"
                  name="model-bridge-docs-api-key"
                  :type="keyVisible ? 'text' : 'password'"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="mb-xxxxxxxx"
                  @keyup.enter="save"
                />
                <button type="button" :aria-label="keyVisible ? '隐藏 API Key' : '显示 API Key'" @click="keyVisible = !keyVisible">
                  <svg v-if="!keyVisible" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M2.04 12.32a1.01 1.01 0 010-.64C3.42 7.51 7.36 4.5 12 4.5c4.64 0 8.58 3.01 9.96 7.18.07.21.07.43 0 .64C20.58 16.49 16.64 19.5 12 19.5c-4.64 0-8.58-3.01-9.96-7.18zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.22A10.48 10.48 0 002.04 11.68c-.07.21-.07.43 0 .64C3.42 16.49 7.36 19.5 12 19.5c1.76 0 3.42-.43 4.88-1.18M6.23 6.23A10.45 10.45 0 0112 4.5c4.64 0 8.58 3.01 9.96 7.18.07.21.07.43 0 .64a10.5 10.5 0 01-2.14 3.74M6.23 6.23 3 3m3.23 3.23 3.65 3.65m9.94 6.18L21 21m-4.12-4.12-3.65-3.65m0 0A3 3 0 019.88 9.88m3.35 3.35a3 3 0 01-3.35-3.35" />
                  </svg>
                </button>
              </div>

              <div v-if="draftMatchesSaved" class="authorization-success" role="status">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                已授权（{{ maskedKey }}）
              </div>
              <p class="storage-warning">请仅在可信设备上保存。任何能在此页面运行的脚本都可能读取浏览器本地存储。</p>
            </div>

            <footer>
              <button type="button" class="clear-button" :disabled="!hasAuthorization && !draftKey" @click="clear">清除</button>
              <button type="button" class="save-button" @click="save">保存授权</button>
            </footer>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.authorization-control { @apply flex; }
.authorization-trigger { @apply flex h-9 max-w-[13rem] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 shadow-sm transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300 dark:hover:border-primary-700 dark:hover:bg-primary-900/20 dark:hover:text-primary-300; }
.authorization-trigger svg { @apply h-4 w-4 flex-shrink-0; }
.authorization-trigger span { @apply truncate font-mono; }
.authorization-trigger i { @apply h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500; }
.authorization-trigger-active { @apply border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/15 dark:text-emerald-300; }

.authorization-backdrop { @apply fixed inset-0 z-50 flex items-center justify-center bg-gray-950/25 p-4 backdrop-blur-[2px] dark:bg-black/50; }
.authorization-dialog { @apply w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/15 dark:border-dark-700 dark:bg-dark-900 dark:shadow-black/40; }
.authorization-dialog > header { @apply grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 px-5 pb-3 pt-5; }
.dialog-icon { @apply flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/25 dark:text-primary-300; }
.dialog-icon svg { @apply h-5 w-5; }
.authorization-dialog h2 { @apply text-base font-extrabold text-gray-950 dark:text-white; }
.authorization-dialog header p { @apply mt-1 text-xs leading-5 text-gray-500 dark:text-dark-400; }
.dialog-close { @apply flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:hover:bg-dark-800 dark:hover:text-white; }
.dialog-close svg { @apply h-4 w-4; }

.dialog-body { @apply grid gap-2.5 px-5 py-3; }
.dialog-body > label { @apply text-xs font-bold text-gray-600 dark:text-dark-300; }
.key-input-group { @apply grid grid-cols-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/10 dark:border-dark-700 dark:bg-dark-800; }
.key-input-group > span { @apply flex items-center border-r border-gray-200 bg-gray-50 px-3 font-mono text-[11px] text-gray-400 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-500; }
.key-input-group input { @apply min-w-0 bg-transparent px-3 py-2.5 font-mono text-xs text-gray-800 outline-none placeholder:text-gray-300 dark:text-dark-100 dark:placeholder:text-dark-600; }
.key-input-group button { @apply flex w-9 items-center justify-center text-gray-400 transition hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/30 dark:hover:text-white; }
.key-input-group button svg { @apply h-4 w-4; }
.authorization-success { @apply flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/15 dark:text-emerald-300; }
.authorization-success svg { @apply h-3.5 w-3.5 flex-shrink-0; }
.storage-warning { @apply text-[10px] leading-4 text-gray-400 dark:text-dark-500; }

.authorization-dialog > footer { @apply flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 dark:border-dark-800; }
.authorization-dialog footer button { @apply rounded-lg px-4 py-2 text-xs font-bold transition active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-40; }
.clear-button { @apply border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300 dark:hover:text-white; }
.save-button { @apply bg-gray-950 text-white shadow-sm hover:bg-gray-800 dark:bg-white dark:text-dark-950 dark:hover:bg-gray-100; }

@media (max-width: 639px) {
  .authorization-trigger { @apply w-9 px-0; }
  .authorization-trigger span { @apply hidden; }
  .authorization-dialog { @apply max-w-none; }
}
</style>
