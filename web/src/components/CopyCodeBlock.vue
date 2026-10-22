<script setup lang="ts">
import { ref } from 'vue'
import { useMessage } from '../composables/useMessage'

const props = defineProps<{ value: string }>()
const code = ref<HTMLElement | null>(null)
const message = useMessage()

async function copy() {
  const text = code.value?.textContent ?? ''
  try {
    await navigator.clipboard.writeText(text)
    message.success('代码已复制')
  } catch {
    message.warning('无法自动复制，请选中代码手动复制')
  }
}
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-xl border border-gray-200 dark:border-dark-700">
    <div class="flex justify-end bg-gray-50 px-3 py-1.5 dark:bg-dark-800">
      <UiButton size="small" quaternary aria-label="复制代码示例" @click="copy">复制代码</UiButton>
    </div>
    <pre ref="code" class="code-block !m-0 !rounded-none"><code>{{ props.value }}</code></pre>
  </div>
</template>
