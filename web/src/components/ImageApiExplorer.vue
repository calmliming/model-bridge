<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useMessage } from '../composables/useMessage'

interface ImageResultRow {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

const props = defineProps<{
  mode: 'generation' | 'edit'
  baseUrl: string
  apiKey: string
}>()

const emit = defineEmits<{ (event: 'requestAuthorization'): void }>()
const message = useMessage()

const prompt = ref('')
const model = ref('gpt-image-2')
const size = ref('1024x1024')
const responseFormat = ref<'url' | 'b64_json'>('url')
const imageFile = ref<File | null>(null)
const inputPreviewUrl = ref('')
const loading = ref(false)
const errorMessage = ref('')
const responseBody = ref<unknown>(null)
const responseStatus = ref<number | null>(null)
const elapsedMs = ref<number | null>(null)
let requestController: AbortController | null = null

const isEdit = computed(() => props.mode === 'edit')
const endpoint = computed(() => `${props.baseUrl}/images/${isEdit.value ? 'edits' : 'generations'}`)
const canSubmit = computed(() =>
  !!props.apiKey.trim() && !!prompt.value.trim() && (!isEdit.value || !!imageFile.value) && !loading.value,
)

const responseRecord = computed<Record<string, unknown> | null>(() =>
  responseBody.value && typeof responseBody.value === 'object' && !Array.isArray(responseBody.value)
    ? responseBody.value as Record<string, unknown>
    : null,
)

const outputFormat = computed(() => {
  const value = responseRecord.value?.output_format
  return typeof value === 'string' && value ? value : 'png'
})

const resultRows = computed<ImageResultRow[]>(() => {
  const data = responseRecord.value?.data
  if (!Array.isArray(data)) return []
  return data.filter((item): item is ImageResultRow => !!item && typeof item === 'object')
})

const outputImages = computed(() => {
  const images: Array<{ src: string; revisedPrompt?: string }> = []
  for (const item of resultRows.value) {
    if (typeof item.url === 'string' && item.url) {
      images.push({ src: item.url, revisedPrompt: item.revised_prompt })
    } else if (typeof item.b64_json === 'string' && item.b64_json) {
      const format = outputFormat.value === 'jpg' ? 'jpeg' : outputFormat.value
      images.push({ src: `data:image/${format};base64,${item.b64_json}`, revisedPrompt: item.revised_prompt })
    }
  }
  return images
})

const formattedResponse = computed(() =>
  responseBody.value == null ? '' : JSON.stringify(responseBody.value, null, 2),
)

const statusTone = computed(() => {
  if (responseStatus.value == null) return 'idle'
  if (responseStatus.value >= 200 && responseStatus.value < 300) return 'success'
  return 'error'
})

const generatedCurl = computed(() => {
  if (isEdit.value) {
    return [
      `curl ${endpoint.value} \\`,
      '  -H "Authorization: Bearer mb-xxxxxxxx" \\',
      `  -F "model=${model.value}" \\`,
      `  -F "prompt=${prompt.value || '把天空替换成极光'}" \\`,
      `  -F "size=${size.value}" \\`,
      `  -F "response_format=${responseFormat.value}" \\`,
      `  -F "image=@./${imageFile.value?.name || 'source.png'}"`,
    ].join('\n')
  }
  return [
    `curl ${endpoint.value} \\`,
    '  -H "Authorization: Bearer mb-xxxxxxxx" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '${JSON.stringify({
      model: model.value,
      prompt: prompt.value || '一只坐在窗边的橘猫',
      size: size.value,
      response_format: responseFormat.value,
    }, null, 2)}'`,
  ].join('\n')
})

function errorFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fallback
  const error = (body as Record<string, unknown>).error
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

function onFileSelected(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  errorMessage.value = ''
  if (file && file.size > 20 * 1024 * 1024) {
    imageFile.value = null
    ;(event.target as HTMLInputElement).value = ''
    errorMessage.value = '图片文件不能超过 20 MB。'
    return
  }
  if (inputPreviewUrl.value) URL.revokeObjectURL(inputPreviewUrl.value)
  imageFile.value = file
  inputPreviewUrl.value = file ? URL.createObjectURL(file) : ''
}

async function runTest(): Promise<void> {
  if (!props.apiKey.trim()) {
    errorMessage.value = '请先通过页面右上角配置 API Key。'
    return
  }
  if (!prompt.value.trim()) {
    errorMessage.value = '请输入提示词。'
    return
  }
  if (isEdit.value && !imageFile.value) {
    errorMessage.value = '请选择需要编辑的图片。'
    return
  }

  requestController?.abort()
  requestController = new AbortController()
  loading.value = true
  errorMessage.value = ''
  responseBody.value = null
  responseStatus.value = null
  elapsedMs.value = null
  const startedAt = performance.now()

  try {
    let body: BodyInit
    const headers: Record<string, string> = {
      Authorization: `Bearer ${props.apiKey.trim()}`,
    }

    if (isEdit.value) {
      const form = new FormData()
      form.append('model', model.value)
      form.append('prompt', prompt.value.trim())
      form.append('size', size.value)
      form.append('response_format', responseFormat.value)
      form.append('image', imageFile.value!)
      body = form
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({
        model: model.value,
        prompt: prompt.value.trim(),
        size: size.value,
        response_format: responseFormat.value,
      })
    }

    const response = await fetch(endpoint.value, {
      method: 'POST',
      headers,
      body,
      signal: requestController.signal,
    })
    responseStatus.value = response.status
    const text = await response.text()
    let parsed: unknown = text
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        // Preserve non-JSON upstream errors for inspection.
      }
    }
    responseBody.value = parsed
    if (!response.ok) {
      errorMessage.value = errorFromBody(parsed, `请求失败（HTTP ${response.status}）`)
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      errorMessage.value = '请求已取消。'
    } else {
      errorMessage.value = (error as Error).message || '网络请求失败。'
    }
  } finally {
    elapsedMs.value = Math.round(performance.now() - startedAt)
    loading.value = false
    requestController = null
  }
}

function cancelTest(): void {
  requestController?.abort()
}

function resetTest(): void {
  requestController?.abort()
  errorMessage.value = ''
  responseBody.value = null
  responseStatus.value = null
  elapsedMs.value = null
}

async function copyText(text: string): Promise<void> {
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (copied) message.success('已复制到剪贴板')
    else message.error('复制失败，请手动复制')
  }
}

function downloadImage(src: string, index: number): void {
  const link = document.createElement('a')
  link.href = src
  link.download = `model-bridge-${isEdit.value ? 'edit' : 'generation'}-${index + 1}.${outputFormat.value}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

onBeforeUnmount(() => {
  requestController?.abort()
  if (inputPreviewUrl.value) URL.revokeObjectURL(inputPreviewUrl.value)
})
</script>

<template>
  <section class="explorer" aria-label="在线 API 调试">
    <header class="explorer-header">
      <div>
        <span class="live-label"><i /> LIVE REQUEST</span>
        <h3>在线调试</h3>
        <p>请求将直接发送到当前 Model Bridge 服务。</p>
      </div>
      <code>{{ endpoint }}</code>
    </header>

    <div class="billing-notice">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.052 3.38c.865-1.5 3.03-1.5 3.896 0l7.355 12.746zM12 15.75h.008v.008H12v-.008z" />
      </svg>
      <p><strong>这是真实请求，会消耗账户额度。</strong>请求使用页面右上角保存的 API Key，密钥不会显示在响应日志中。</p>
    </div>

    <div class="explorer-grid">
      <form class="explorer-form" @submit.prevent="runTest">
        <div class="explorer-auth-state" :class="apiKey ? 'explorer-auth-ready' : 'explorer-auth-missing'">
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.03 5.91c-.56-.1-1.16.03-1.56.43l-2.66 2.66H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5A6 6 0 1121.75 8.25z" />
            </svg>
          </span>
          <div>
            <strong>{{ apiKey ? '已使用全局授权' : '尚未配置 API Key' }}</strong>
            <small>{{ apiKey ? '可直接发送本次请求' : '配置后用于所有在线调试接口' }}</small>
          </div>
          <button type="button" @click="emit('requestAuthorization')">{{ apiKey ? '更换' : '配置' }}</button>
        </div>

        <label v-if="isEdit" class="field-group">
          <span>原始图片 <b>必填</b></span>
          <span class="file-picker">
            <input type="file" accept="image/*" @change="onFileSelected" />
            <span class="file-picker-copy">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-6L12 6m0 0 4.5 4.5M12 6v12" />
              </svg>
              <strong>{{ imageFile?.name || '选择图片文件' }}</strong>
              <small>PNG、JPEG 或 WebP，最大 20 MB</small>
            </span>
          </span>
        </label>

        <label class="field-group">
          <span>Prompt <b>必填</b></span>
          <UiInput
            v-model:value="prompt"
            type="textarea"
            :rows="4"
            :placeholder="isEdit ? '例如：把天空替换成极光，保留前景建筑' : '例如：一只坐在窗边的橘猫，午后阳光，写实摄影风格'"
          />
        </label>

        <div class="field-row">
          <label class="field-group">
            <span>模型</span>
            <UiInput v-model:value="model" placeholder="gpt-image-2" />
          </label>
          <label class="field-group">
            <span>尺寸</span>
            <UiSelect
              v-model:value="size"
              :options="[
                { label: '1024 × 1024', value: '1024x1024' },
                { label: '1536 × 1024', value: '1536x1024' },
                { label: '1024 × 1536', value: '1024x1536' },
                { label: '自动', value: 'auto' },
              ]"
            />
          </label>
        </div>

        <label class="field-group">
          <span>响应格式</span>
          <UiSelect
            v-model:value="responseFormat"
            :options="[
              { label: 'Data URL（便于预览）', value: 'url' },
              { label: 'Base64 JSON', value: 'b64_json' },
            ]"
          />
        </label>

        <p v-if="errorMessage && responseBody == null" class="inline-error" role="alert">{{ errorMessage }}</p>

        <div class="form-actions">
          <UiButton native-type="submit" type="primary" :loading="loading" :disabled="!canSubmit">
            {{ loading ? '请求中' : '发送请求（将计费）' }}
          </UiButton>
          <UiButton v-if="loading" type="error" secondary @click="cancelTest">取消</UiButton>
          <UiButton v-else secondary @click="copyText(generatedCurl)">复制 cURL</UiButton>
        </div>
      </form>

      <section class="explorer-output" aria-live="polite">
        <header>
          <div>
            <h4>响应</h4>
            <span v-if="responseStatus != null" class="status-code" :class="statusTone">HTTP {{ responseStatus }}</span>
          </div>
          <div class="output-meta">
            <span v-if="elapsedMs != null">{{ elapsedMs }} ms</span>
            <button v-if="responseBody != null" type="button" @click="resetTest">清空</button>
          </div>
        </header>

        <div v-if="loading" class="output-loading">
          <span class="spinner" />
          <strong>{{ isEdit ? '正在编辑图片' : '正在生成图片' }}</strong>
          <p>生图通常需要较长时间，请保持当前页面打开。</p>
        </div>

        <div v-else-if="responseBody == null" class="output-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.16-5.16a2.25 2.25 0 013.18 0l5.16 5.16m-1.5-1.5 1.41-1.41a2.25 2.25 0 013.18 0l2.91 2.91M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
          </svg>
          <strong>等待请求</strong>
          <p>填写左侧参数并发送后，这里会显示图片与原始响应。</p>
        </div>

        <div v-else class="output-result">
          <p v-if="errorMessage" class="response-error" role="alert">{{ errorMessage }}</p>

          <div v-if="outputImages.length" class="image-results">
            <figure v-for="(image, index) in outputImages" :key="`${index}-${image.src.slice(-24)}`">
              <img :src="image.src" :alt="`${isEdit ? '编辑' : '生成'}结果 ${index + 1}`" />
              <figcaption>
                <span>结果 {{ index + 1 }}</span>
                <button type="button" @click="downloadImage(image.src, index)">下载</button>
              </figcaption>
              <p v-if="image.revisedPrompt">{{ image.revisedPrompt }}</p>
            </figure>
          </div>

          <details class="raw-response" :open="!outputImages.length">
            <summary>原始响应 JSON</summary>
            <div>
              <button type="button" @click="copyText(formattedResponse)">复制</button>
              <pre><code>{{ formattedResponse }}</code></pre>
            </div>
          </details>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.explorer { @apply overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-dark-700 dark:bg-dark-900; }
.explorer-header { @apply flex flex-col gap-3 border-b border-gray-200 bg-gray-50/80 px-5 py-4 dark:border-dark-700 dark:bg-dark-800/60 sm:flex-row sm:items-center sm:justify-between; }
.explorer-header h3 { @apply mt-1 text-base font-extrabold text-gray-950 dark:text-white; }
.explorer-header p { @apply mt-0.5 text-xs text-gray-500 dark:text-dark-400; }
.explorer-header > code { @apply max-w-full overflow-x-auto whitespace-nowrap rounded-md bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 dark:bg-dark-800 dark:text-dark-300; }
.live-label { @apply inline-flex items-center gap-1.5 font-mono text-[9px] font-black tracking-[0.12em] text-emerald-600 dark:text-emerald-400; }
.live-label i { @apply h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]; }

.billing-notice { @apply flex gap-3 border-b border-amber-200 bg-amber-50/70 px-5 py-3 text-xs leading-5 text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300; }
.billing-notice svg { @apply mt-0.5 h-4 w-4 flex-shrink-0; }
.billing-notice strong { @apply mr-1 font-bold; }

.explorer-grid { @apply grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]; }
.explorer-form { @apply grid content-start gap-4 border-b border-gray-200 p-5 dark:border-dark-700 lg:border-b-0 lg:border-r; }
.explorer-auth-state { @apply grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5; }
.explorer-auth-state > span { @apply flex h-8 w-8 items-center justify-center rounded-lg; }
.explorer-auth-state svg { @apply h-4 w-4; }
.explorer-auth-state strong { @apply block text-xs font-bold; }
.explorer-auth-state small { @apply mt-0.5 block text-[10px]; }
.explorer-auth-state button { @apply rounded-md border px-2.5 py-1.5 text-[10px] font-bold transition active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30; }
.explorer-auth-ready { @apply border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-900/10; }
.explorer-auth-ready > span { @apply bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300; }
.explorer-auth-ready strong { @apply text-emerald-800 dark:text-emerald-300; }
.explorer-auth-ready small { @apply text-emerald-600 dark:text-emerald-400; }
.explorer-auth-ready button { @apply border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-dark-800 dark:text-emerald-300; }
.explorer-auth-missing { @apply border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-900/10; }
.explorer-auth-missing > span { @apply bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300; }
.explorer-auth-missing strong { @apply text-amber-800 dark:text-amber-300; }
.explorer-auth-missing small { @apply text-amber-600 dark:text-amber-400; }
.explorer-auth-missing button { @apply border-amber-200 bg-white text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:bg-dark-800 dark:text-amber-300; }
.field-group { @apply grid gap-1.5; }
.field-group > span:first-child { @apply text-xs font-bold text-gray-700 dark:text-dark-200; }
.field-group b { @apply ml-1 text-[9px] font-semibold text-red-500; }
.field-row { @apply grid gap-3 sm:grid-cols-2; }

.file-picker { @apply relative block cursor-pointer overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50 transition hover:border-primary-400 hover:bg-primary-50/40 focus-within:ring-2 focus-within:ring-primary-500/20 dark:border-dark-600 dark:bg-dark-800/60 dark:hover:border-primary-700; }
.file-picker input { @apply absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0; }
.file-picker-copy { @apply flex min-h-[5rem] flex-col items-center justify-center px-3 py-3 text-center; }
.file-picker-copy svg { @apply mb-1 h-5 w-5 text-gray-400; }
.file-picker-copy strong { @apply max-w-full truncate text-xs font-semibold text-gray-700 dark:text-dark-200; }
.file-picker-copy small { @apply mt-1 text-[10px] text-gray-400; }

.inline-error, .response-error { @apply rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-900/15 dark:text-red-300; }
.form-actions { @apply flex flex-wrap items-center gap-2 pt-1; }

.explorer-output { @apply min-h-[24rem] min-w-0 bg-gray-50/50 dark:bg-dark-950/30; }
.explorer-output > header { @apply flex min-h-[3.5rem] items-center justify-between gap-3 border-b border-gray-200 px-5 dark:border-dark-700; }
.explorer-output > header > div { @apply flex items-center gap-2; }
.explorer-output h4 { @apply text-sm font-extrabold text-gray-900 dark:text-white; }
.status-code { @apply rounded px-1.5 py-0.5 font-mono text-[9px] font-bold; }
.status-code.success { @apply bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300; }
.status-code.error { @apply bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300; }
.output-meta { @apply text-[10px] font-medium text-gray-400; }
.output-meta button { @apply transition hover:text-primary-600 dark:hover:text-primary-300; }

.output-empty, .output-loading { @apply flex min-h-[20rem] flex-col items-center justify-center px-6 text-center; }
.output-empty svg { @apply mb-3 h-8 w-8 text-gray-300 dark:text-dark-600; }
.output-empty strong, .output-loading strong { @apply text-sm font-bold text-gray-700 dark:text-dark-200; }
.output-empty p, .output-loading p { @apply mt-1 max-w-[32ch] text-xs leading-5 text-gray-400 dark:text-dark-500; }
.output-loading .spinner { @apply mb-4 h-7 w-7 text-primary-500; }

.output-result { @apply grid gap-4 p-5; }
.image-results { @apply grid gap-4 sm:grid-cols-2; }
.image-results figure { @apply min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-dark-700 dark:bg-dark-900; }
.image-results img { @apply aspect-square w-full bg-gray-100 object-contain dark:bg-dark-800; }
.image-results figcaption { @apply flex items-center justify-between border-t border-gray-100 px-3 py-2 text-[11px] font-semibold text-gray-500 dark:border-dark-800 dark:text-dark-400; }
.image-results figcaption button { @apply text-primary-600 transition hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200; }
.image-results figure > p { @apply border-t border-gray-100 px-3 py-2 text-[10px] leading-4 text-gray-400 dark:border-dark-800; }

.raw-response { @apply overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-dark-700 dark:bg-dark-900; }
.raw-response summary { @apply cursor-pointer px-3 py-2.5 text-xs font-bold text-gray-600 outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500/30 dark:text-dark-300 dark:hover:text-white; }
.raw-response > div { @apply relative border-t border-gray-200 bg-slate-950 dark:border-dark-700; }
.raw-response button { @apply absolute right-2 top-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:text-white; }
.raw-response pre { @apply max-h-80 overflow-auto p-4 pr-16 text-[11px] leading-5 text-slate-200; }
.raw-response code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
</style>
