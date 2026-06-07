<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ) => string
  reset: (widgetId?: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
    __modelBridgeTurnstileLoading?: Promise<void>
  }
}

const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{ (e: 'update:token', value: string): void }>()

const container = ref<HTMLElement | null>(null)
let widgetId: string | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (window.__modelBridgeTurnstileLoading) return window.__modelBridgeTurnstileLoading
  window.__modelBridgeTurnstileLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('failed to load Turnstile'))
    document.head.appendChild(script)
  })
  return window.__modelBridgeTurnstileLoading
}

async function renderWidget() {
  if (widgetId) return
  await loadScript()
  await nextTick()
  if (!container.value || !window.turnstile) return
  widgetId = window.turnstile.render(container.value, {
    sitekey: props.siteKey,
    callback: (token) => emit('update:token', token),
    'expired-callback': () => emit('update:token', ''),
    'error-callback': () => emit('update:token', ''),
  })
}

function removeWidget() {
  if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
  widgetId = null
  emit('update:token', '')
}

function reset() {
  emit('update:token', '')
  if (widgetId && window.turnstile) window.turnstile.reset(widgetId)
}

onMounted(() => {
  void renderWidget()
})

onBeforeUnmount(removeWidget)

watch(() => props.siteKey, async () => {
  removeWidget()
  await renderWidget()
})

defineExpose({ reset })
</script>

<template>
  <div class="turnstile-box">
    <div ref="container" />
  </div>
</template>

<style scoped>
.turnstile-box {
  min-height: 65px;
}
</style>
