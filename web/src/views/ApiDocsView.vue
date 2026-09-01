<script setup lang="ts">
import { computed } from 'vue'
import { useMessage } from '../composables/useMessage'

interface ParameterRow {
  name: string
  type: string
  required: boolean
  defaultValue: string
  description: string
}

const message = useMessage()

const baseOrigin = computed(() => {
  if (typeof window === 'undefined') return 'http://localhost:3000'
  return window.location.origin
})

const apiBaseUrl = computed(() => `${baseOrigin.value}/v1`)

const generationParameters: ParameterRow[] = [
  { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '用于描述目标图片的提示词。' },
  { name: 'model', type: 'string', required: false, defaultValue: 'gpt-image-2', description: '图片模型，名称必须以 gpt-image- 开头。' },
  { name: 'n', type: 'integer', required: false, defaultValue: '1', description: '生成数量，范围为 1～10，最终受上游模型限制。' },
  { name: 'size', type: 'string', required: false, defaultValue: '模型默认', description: '图片尺寸，例如 1024x1024，或使用 auto。' },
  { name: 'quality', type: 'string', required: false, defaultValue: '模型默认', description: '输出质量，例如 high；支持值由上游模型决定。' },
  { name: 'output_format', type: 'string', required: false, defaultValue: '模型默认', description: '输出格式，例如 png、jpeg 或 webp。' },
  { name: 'response_format', type: 'string', required: false, defaultValue: 'b64_json', description: '可选 b64_json 或 url；url 返回可直接展示的 Data URL。' },
  { name: 'stream', type: 'boolean', required: false, defaultValue: 'false', description: '开启后通过 Server-Sent Events 返回进度和结果。' },
  { name: 'partial_images', type: 'integer', required: false, defaultValue: '0', description: '流式中间图数量，范围为 0～3。' },
]

const editParameters: ParameterRow[] = [
  { name: 'image', type: 'file | string', required: true, defaultValue: '—', description: '待编辑图片。支持 multipart 文件、图片 URL、Data URL 或 file_id。' },
  { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '说明需要进行的图片修改。' },
  { name: 'mask', type: 'file | string', required: false, defaultValue: '—', description: '可选遮罩图；JSON 方式仅支持 mask.image_url。' },
  { name: 'model', type: 'string', required: false, defaultValue: 'gpt-image-2', description: '图片模型，名称必须以 gpt-image- 开头。' },
  { name: 'size', type: 'string', required: false, defaultValue: '模型默认', description: '输出图片尺寸，例如 1024x1024。' },
  { name: 'response_format', type: 'string', required: false, defaultValue: 'b64_json', description: '可选 b64_json 或 url。' },
  { name: 'stream', type: 'boolean', required: false, defaultValue: 'false', description: '是否使用 SSE 流式返回。' },
]

const generationCurl = computed(() => [
  `curl ${apiBaseUrl.value}/images/generations \\`,
  '  -H "Authorization: Bearer mb-xxxxxxxx" \\',
  '  -H "Content-Type: application/json" \\',
  `  -d '{
    "model": "gpt-image-2",
    "prompt": "一只坐在窗边的橘猫，午后阳光，写实摄影风格",
    "size": "1024x1024",
    "quality": "high",
    "response_format": "url"
  }'`,
].join('\n'))

const generationJavaScript = computed(() => [
  `const response = await fetch('${apiBaseUrl.value}/images/generations', {`,
  "  method: 'POST',",
  '  headers: {',
  "    'Content-Type': 'application/json',",
  '    Authorization: `Bearer ${apiKey}`,',
  '  },',
  '  body: JSON.stringify({',
  "    model: 'gpt-image-2',",
  "    prompt: '一只坐在窗边的橘猫',",
  "    size: '1024x1024',",
  "    response_format: 'url',",
  '  }),',
  '})',
  '',
  'const result = await response.json()',
  "if (!response.ok) throw new Error(result.error?.message || result.error || '生图失败')",
  "document.querySelector('#result').src = result.data[0].url",
].join('\n'))

const generationResponse = `{
  "created": 1788246000,
  "data": [
    {
      "url": "data:image/png;base64,iVBORw0KGgoAAA..."
    }
  ],
  "output_format": "png",
  "quality": "high",
  "size": "1024x1024",
  "model": "gpt-image-2",
  "usage": {
    "input_tokens": 123,
    "output_tokens": 456
  }
}`

const editCurl = computed(() => [
  `curl ${apiBaseUrl.value}/images/edits \\`,
  '  -H "Authorization: Bearer mb-xxxxxxxx" \\',
  '  -F "model=gpt-image-2" \\',
  '  -F "prompt=把天空替换成极光，保留前景建筑" \\',
  '  -F "response_format=url" \\',
  '  -F "image=@./source.png"',
].join('\n'))

const editJavaScript = computed(() => [
  'const form = new FormData()',
  "form.append('model', 'gpt-image-2')",
  "form.append('prompt', '把天空替换成极光')",
  "form.append('response_format', 'url')",
  "form.append('image', fileInput.files[0])",
  '',
  `const response = await fetch('${apiBaseUrl.value}/images/edits', {`,
  "  method: 'POST',",
  '  headers: { Authorization: `Bearer ${apiKey}` },',
  '  body: form,',
  '})',
  '',
  'const result = await response.json()',
  "if (!response.ok) throw new Error(result.error?.message || result.error || '编辑失败')",
  "document.querySelector('#result').src = result.data[0].url",
].join('\n'))

const streamCurl = computed(() => [
  `curl -N ${apiBaseUrl.value}/images/generations \\`,
  '  -H "Authorization: Bearer mb-xxxxxxxx" \\',
  '  -H "Content-Type: application/json" \\',
  `  -d '{
    "model": "gpt-image-2",
    "prompt": "未来城市夜景",
    "stream": true,
    "partial_images": 2
  }'`,
].join('\n'))

const streamResponse = `event: image_generation.partial_image
data: {"type":"image_generation.partial_image","partial_image_index":0,"b64_json":"..."}

event: image_generation.completed
data: {"type":"image_generation.completed","b64_json":"...","size":"1024x1024","model":"gpt-image-2"}`

async function copy(text: string): Promise<void> {
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
    else message.error('复制失败，请手动选择文本')
  }
}
</script>

<template>
  <div class="grid gap-5">
    <section class="overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-br from-white via-primary-50/60 to-violet-50 p-5 shadow-sm dark:border-primary-900/40 dark:from-dark-900 dark:via-primary-950/30 dark:to-dark-900 sm:p-7">
      <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div class="max-w-2xl">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <UiTag type="success">接口已内置</UiTag>
            <UiTag type="primary">OpenAI Images 兼容</UiTag>
            <UiTag>JSON · multipart · SSE</UiTag>
          </div>
          <h2 class="text-2xl font-black tracking-tight text-gray-950 dark:text-white sm:text-3xl">图片生成 API</h2>
          <p class="mt-2 max-w-xl text-sm leading-6 text-gray-600 dark:text-dark-300">
            使用一个统一入口完成文生图、图片编辑和流式中间图输出。请求通过平台 API Key 鉴权，并自动纳入现有额度与用量统计。
          </p>
        </div>
        <div class="min-w-0 lg:w-[430px]">
          <span class="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-dark-400">Base URL</span>
          <div class="flex min-w-0 items-center gap-2 rounded-xl border border-white/80 bg-white/90 p-2 pl-3 shadow-sm dark:border-dark-700 dark:bg-dark-800/90">
            <code class="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-dark-100">{{ apiBaseUrl }}</code>
            <UiButton size="small" secondary @click="copy(apiBaseUrl)">复制</UiButton>
          </div>
        </div>
      </div>
    </section>

    <UiAlert type="warning" title="安全提示">
      公网网站不要把固定 API Key 写入前端源码。面向匿名访客时，请由业务后端保管 Key 并代理调用；跨域前端还需要在反向代理中按来源配置 CORS。
    </UiAlert>

    <UiGrid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
      <UiGi span="3 m:1">
        <div class="h-full rounded-2xl border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-900">
          <div class="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/25 dark:text-primary-300">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.03 5.91c-.56-.1-1.16.03-1.56.43l-2.66 2.66H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <strong class="text-sm text-gray-950 dark:text-white">Bearer 鉴权</strong>
          <p class="mt-1.5 text-[13px] leading-5 text-gray-500 dark:text-dark-400">请求头使用 <code class="code-inline">Authorization: Bearer mb-...</code></p>
        </div>
      </UiGi>
      <UiGi span="3 m:1">
        <div class="h-full rounded-2xl border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-900">
          <div class="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-900/25 dark:text-violet-300">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.16-5.16a2.25 2.25 0 013.18 0l5.16 5.16m-1.5-1.5 1.41-1.41a2.25 2.25 0 013.18 0l2.91 2.91M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.01v.01h-.01v-.01z" />
            </svg>
          </div>
          <strong class="text-sm text-gray-950 dark:text-white">默认模型</strong>
          <p class="mt-1.5 text-[13px] leading-5 text-gray-500 dark:text-dark-400">未传模型时使用 <code class="code-inline">gpt-image-2</code></p>
        </div>
      </UiGi>
      <UiGi span="3 m:1">
        <div class="h-full rounded-2xl border border-gray-200 bg-white p-5 dark:border-dark-700 dark:bg-dark-900">
          <div class="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/25 dark:text-emerald-300">
            <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.5h16.5m-16.5 15h16.5M6.75 8.25l3.75 3.75-3.75 3.75M12.75 15.75h4.5" />
            </svg>
          </div>
          <strong class="text-sm text-gray-950 dark:text-white">返回格式</strong>
          <p class="mt-1.5 text-[13px] leading-5 text-gray-500 dark:text-dark-400"><code class="code-inline">b64_json</code> 或可直接赋给 img 的 Data URL</p>
        </div>
      </UiGi>
    </UiGrid>

    <UiCard title="接口参考">
      <UiTabs>
        <UiTabPane name="generation" tab="图片生成">
          <div class="grid gap-5">
            <div class="endpoint-bar">
              <span class="method-post">POST</span>
              <code>{{ apiBaseUrl }}/images/generations</code>
              <UiButton class="ml-auto" size="tiny" secondary @click="copy(`${apiBaseUrl}/images/generations`)">复制地址</UiButton>
            </div>

            <p class="doc-copy">根据文本提示词生成一张或多张图片。请求体使用 <code class="code-inline">application/json</code>。</p>

            <div>
              <h3 class="section-title">请求参数</h3>
              <div class="table-wrap">
                <table class="doc-table">
                  <thead>
                    <tr><th>参数</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="parameter in generationParameters" :key="parameter.name">
                      <td><code>{{ parameter.name }}</code></td>
                      <td>{{ parameter.type }}</td>
                      <td><span :class="parameter.required ? 'required' : 'optional'">{{ parameter.required ? '是' : '否' }}</span></td>
                      <td>{{ parameter.defaultValue }}</td>
                      <td>{{ parameter.description }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 class="section-title">调用示例</h3>
              <UiTabs>
                <UiTabPane name="generation-curl" tab="cURL">
                  <div class="code-shell">
                    <button type="button" class="copy-code" @click="copy(generationCurl)">复制代码</button>
                    <pre><code>{{ generationCurl }}</code></pre>
                  </div>
                </UiTabPane>
                <UiTabPane name="generation-js" tab="JavaScript">
                  <div class="code-shell">
                    <button type="button" class="copy-code" @click="copy(generationJavaScript)">复制代码</button>
                    <pre><code>{{ generationJavaScript }}</code></pre>
                  </div>
                </UiTabPane>
              </UiTabs>
            </div>

            <div>
              <h3 class="section-title">响应示例</h3>
              <div class="code-shell">
                <button type="button" class="copy-code" @click="copy(generationResponse)">复制 JSON</button>
                <pre><code>{{ generationResponse }}</code></pre>
              </div>
              <p class="doc-note"><code>response_format=url</code> 返回的是 Data URL，并非可长期访问的公网链接。需要持久化时，请将图片上传到自己的对象存储。</p>
            </div>
          </div>
        </UiTabPane>

        <UiTabPane name="edit" tab="图片编辑">
          <div class="grid gap-5">
            <div class="endpoint-bar">
              <span class="method-post">POST</span>
              <code>{{ apiBaseUrl }}/images/edits</code>
              <UiButton class="ml-auto" size="tiny" secondary @click="copy(`${apiBaseUrl}/images/edits`)">复制地址</UiButton>
            </div>

            <p class="doc-copy">上传原图并通过提示词进行编辑。浏览器上传本地文件时推荐使用 <code class="code-inline">multipart/form-data</code>。</p>

            <UiAlert type="info">
              每个 multipart 文件最大 20 MB，整个请求体最大 64 MB。使用 FormData 时不要手动设置 Content-Type，浏览器会自动补全 boundary。
            </UiAlert>

            <div>
              <h3 class="section-title">请求参数</h3>
              <div class="table-wrap">
                <table class="doc-table">
                  <thead>
                    <tr><th>参数</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="parameter in editParameters" :key="parameter.name">
                      <td><code>{{ parameter.name }}</code></td>
                      <td>{{ parameter.type }}</td>
                      <td><span :class="parameter.required ? 'required' : 'optional'">{{ parameter.required ? '是' : '否' }}</span></td>
                      <td>{{ parameter.defaultValue }}</td>
                      <td>{{ parameter.description }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 class="section-title">调用示例</h3>
              <UiTabs>
                <UiTabPane name="edit-curl" tab="cURL">
                  <div class="code-shell">
                    <button type="button" class="copy-code" @click="copy(editCurl)">复制代码</button>
                    <pre><code>{{ editCurl }}</code></pre>
                  </div>
                </UiTabPane>
                <UiTabPane name="edit-js" tab="JavaScript">
                  <div class="code-shell">
                    <button type="button" class="copy-code" @click="copy(editJavaScript)">复制代码</button>
                    <pre><code>{{ editJavaScript }}</code></pre>
                  </div>
                </UiTabPane>
              </UiTabs>
            </div>
          </div>
        </UiTabPane>

        <UiTabPane name="stream" tab="流式响应">
          <div class="grid gap-5">
            <div>
              <h3 class="section-title">SSE 事件</h3>
              <div class="grid gap-3 sm:grid-cols-2">
                <div class="event-card">
                  <UiTag type="primary">生成</UiTag>
                  <code>image_generation.partial_image</code>
                  <code>image_generation.completed</code>
                </div>
                <div class="event-card">
                  <UiTag type="success">编辑</UiTag>
                  <code>image_edit.partial_image</code>
                  <code>image_edit.completed</code>
                </div>
              </div>
            </div>

            <UiAlert type="warning">
              原生 EventSource 不支持 POST 和自定义 Authorization 请求头。Web 端请使用 fetch 读取 ReadableStream，或由业务后端代理流式响应。
            </UiAlert>

            <div>
              <h3 class="section-title">流式请求</h3>
              <div class="code-shell">
                <button type="button" class="copy-code" @click="copy(streamCurl)">复制代码</button>
                <pre><code>{{ streamCurl }}</code></pre>
              </div>
            </div>

            <div>
              <h3 class="section-title">事件示例</h3>
              <div class="code-shell">
                <button type="button" class="copy-code" @click="copy(streamResponse)">复制示例</button>
                <pre><code>{{ streamResponse }}</code></pre>
              </div>
            </div>
          </div>
        </UiTabPane>

        <UiTabPane name="errors" tab="错误处理">
          <div class="grid gap-5">
            <div class="table-wrap">
              <table class="doc-table">
                <thead><tr><th>状态码</th><th>含义</th><th>处理建议</th></tr></thead>
                <tbody>
                  <tr><td><code>400</code></td><td>参数错误、缺少图片或内容策略拒绝</td><td>检查 error.message 后修改请求，不要自动重试。</td></tr>
                  <tr><td><code>401</code></td><td>API Key 缺失、无效、禁用或过期</td><td>检查 Authorization 请求头和 Key 状态。</td></tr>
                  <tr><td><code>402</code></td><td>账户余额不足</td><td>充值后重试。</td></tr>
                  <tr><td><code>403</code></td><td>生图功能关闭，或 Key 无权使用模型</td><td>联系管理员检查功能开关和访问范围。</td></tr>
                  <tr><td><code>413</code></td><td>请求体超过大小限制</td><td>压缩输入图片或减少上传文件。</td></tr>
                  <tr><td><code>429</code></td><td>速率、并发或额度限制</td><td>降低并发并按退避策略重试。</td></tr>
                  <tr><td><code>502 / 503</code></td><td>上游无图片输出或暂无可用账号</td><td>短暂退避后进行有限次数重试。</td></tr>
                </tbody>
              </table>
            </div>

            <div>
              <h3 class="section-title">错误结构</h3>
              <div class="code-shell">
                <pre><code>{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_image_request",
    "message": "prompt is required"
  }
}</code></pre>
              </div>
            </div>
          </div>
        </UiTabPane>
      </UiTabs>
    </UiCard>

    <UiCard title="接入前检查">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="check-item"><span>1</span><p>准备有效的 <code>mb-...</code> API Key</p></div>
        <div class="check-item"><span>2</span><p>确认 Key 允许访问 OpenAI 和图片模型</p></div>
        <div class="check-item"><span>3</span><p>确认上游 OAuth 账号拥有生图权限</p></div>
        <div class="check-item"><span>4</span><p>生产环境配置 HTTPS、超时与限流</p></div>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.endpoint-bar {
  @apply flex min-w-0 items-center gap-3 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm dark:border-dark-700 dark:bg-dark-800/70;
}

.endpoint-bar > code {
  @apply whitespace-nowrap font-semibold text-gray-800 dark:text-dark-100;
}

.method-post {
  @apply rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-black tracking-wide text-emerald-700 dark:bg-emerald-900/35 dark:text-emerald-300;
}

.section-title {
  @apply mb-3 text-sm font-bold text-gray-950 dark:text-white;
}

.doc-copy {
  @apply text-sm leading-6 text-gray-600 dark:text-dark-300;
}

.doc-note {
  @apply mt-2 text-xs leading-5 text-gray-500 dark:text-dark-400;
}

.table-wrap {
  @apply overflow-x-auto rounded-xl border border-gray-200 dark:border-dark-700;
}

.doc-table {
  @apply min-w-[760px] w-full border-collapse text-left text-[13px];
}

.doc-table th {
  @apply whitespace-nowrap border-b border-gray-200 bg-gray-50 px-4 py-3 font-bold text-gray-600 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300;
}

.doc-table td {
  @apply border-b border-gray-100 px-4 py-3 align-top leading-5 text-gray-600 last:border-b-0 dark:border-dark-800 dark:text-dark-300;
}

.doc-table tr:last-child td {
  @apply border-b-0;
}

.doc-table td code {
  @apply whitespace-nowrap font-semibold text-primary-600 dark:text-primary-300;
}

.required {
  @apply font-semibold text-red-600 dark:text-red-400;
}

.optional {
  @apply text-gray-400 dark:text-dark-500;
}

.code-shell {
  @apply relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950;
}

.code-shell pre {
  @apply overflow-x-auto p-4 pr-20 text-[13px] leading-6 text-slate-200;
}

.code-shell code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.copy-code {
  @apply absolute right-2 top-2 z-10 rounded-lg border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white;
}

.event-card {
  @apply grid gap-2 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-dark-700 dark:bg-dark-800/70;
}

.event-card code {
  @apply break-all text-xs font-semibold text-gray-700 dark:text-dark-200;
}

.check-item {
  @apply flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/80 p-4 dark:border-dark-700 dark:bg-dark-800/60;
}

.check-item > span {
  @apply flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-black text-primary-700 dark:bg-primary-900/40 dark:text-primary-300;
}

.check-item p {
  @apply text-[13px] leading-5 text-gray-600 dark:text-dark-300;
}
</style>
