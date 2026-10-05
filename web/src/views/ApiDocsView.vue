<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import ApiDocsAuthorization from '../components/ApiDocsAuthorization.vue'
import ImageApiExplorer from '../components/ImageApiExplorer.vue'
import BrandLogo from '../components/BrandLogo.vue'
import { useCollapsibleSidebar } from '../composables/useCollapsibleSidebar'
import { useMessage } from '../composables/useMessage'
import { useAuthStore } from '../stores/auth'

type DocSection =
  | 'overview' | 'authentication'
  | 'text-chat' | 'text-messages' | 'text-gemini' | 'text-models'
  | 'image-generation' | 'image-edit'
  | 'image-gpt-image-2' | 'image-gpt-image-25' | 'image-gpt-image-vip'
  | 'image-gpt-image-flare' | 'image-gpt-image-sunburst'
  | 'video-generation' | 'video-result' | 'video-async' | 'video-minimax-h3'
  | 'streaming' | 'models' | 'errors' | 'integration'

type DocIcon =
  | 'overview' | 'authentication' | 'chat' | 'code'
  | 'image-generation' | 'image-edit' | 'video'
  | 'streaming' | 'list' | 'errors' | 'plug'

interface ParameterRow {
  name: string
  type: string
  required: boolean
  defaultValue: string
  description: string
}

/**
 * One page per media model. Vendors disagree on almost everything — required
 * fields, size/quality rules, whether a reference image is allowed, how the
 * result is fetched — so each model documents its own contract instead of
 * sharing a table that only fits one of them.
 */
interface MediaModelDoc {
  section: DocSection
  modelId: string
  label: string
  summary: string
  /** Displayed in the endpoint bar; the caller-facing path of this model. */
  endpoint: string
  params: ParameterRow[]
  /** Free-form "this model only" facts shown as a compact table. */
  traits: Array<{ name: string; value: string }>
  pricing: string
  example: string
  notes?: string[]
}

interface NavigationItem {
  id: DocSection
  label: string
  icon: DocIcon
  description: string
  method?: 'GET' | 'POST'
}

interface NavigationGroup {
  label: string
  items: NavigationItem[]
}

const message = useMessage()
const auth = useAuthStore()
const activeSection = ref<DocSection>('overview')
const docsSearch = ref('')
const generationLanguage = ref<'curl' | 'javascript'>('curl')
const editLanguage = ref<'curl' | 'javascript'>('curl')
const testerApiKey = ref('')
const authorizationRef = ref<InstanceType<typeof ApiDocsAuthorization> | null>(null)
const { collapsed: docsSidebarCollapsed, toggle: toggleDocsSidebarCollapsed } = useCollapsibleSidebar('mb_api_docs_sidebar_collapsed')
let previousDocumentTitle = ''

const baseOrigin = computed(() => {
  if (typeof window === 'undefined') return 'http://localhost:3000'
  return window.location.origin
})
const apiBaseUrl = computed(() => `${baseOrigin.value}/v1`)
const consoleEntry = computed(() => {
  const role = auth.preferredSessionRole()
  if (role === 'admin') return { to: '/overview', title: '进入管理控制台', label: '控制台' }
  if (role === 'user') return { to: '/app', title: '进入用户控制台', label: '控制台' }
  return { to: '/login', title: '登录控制台', label: '登录' }
})

const docsIconPaths: Record<DocIcon, string[]> = {
  overview: [
    'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 8.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  ],
  authentication: [
    'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.03 5.91c-.56-.1-1.16.03-1.56.43l-2.66 2.66H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5A6 6 0 1121.75 8.25z',
  ],
  chat: [
    'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155',
  ],
  code: [
    'm6.75 7.5-3 4.5 3 4.5M17.25 7.5l3 4.5-3 4.5M14.25 4.5l-4.5 15',
  ],
  video: [
    'm15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25z',
  ],
  list: [
    'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0z',
  ],
  plug: [
    'M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25z',
  ],
  'image-generation': [
    'm2.25 15.75 5.16-5.16a2.25 2.25 0 013.18 0l5.16 5.16m-1.5-1.5 1.41-1.41a2.25 2.25 0 013.18 0l2.91 2.91M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.01v.01h-.01v-.01z',
    'M18.75 2.25v3m1.5-1.5h-3',
  ],
  'image-edit': [
    'm16.862 4.487 1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 7.125V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18V6A2.25 2.25 0 016 3.75h10.875',
  ],
  streaming: [
    'M8.25 6.75a7.5 7.5 0 010 10.5M5.25 9.75a3.75 3.75 0 010 4.5M15.75 6.75a7.5 7.5 0 000 10.5M18.75 9.75a3.75 3.75 0 000 4.5M12 12h.008v.008H12V12z',
  ],
  errors: [
    'M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.052 3.38c.865-1.5 3.03-1.5 3.896 0l7.355 12.746zM12 15.75h.008v.008H12v-.008z',
  ],
}

const navigationGroups: NavigationGroup[] = [
  {
    label: '开始使用',
    items: [
      { id: 'overview', label: '概览', icon: 'overview', description: '能力范围、入口与快速开始' },
      { id: 'authentication', label: '认证', icon: 'authentication', description: 'API Key 与密钥安全' },
    ],
  },
  {
    label: '文本模型',
    items: [
      { id: 'text-chat', label: '对话补全', icon: 'chat', description: '/chat/completions', method: 'POST' },
      { id: 'text-messages', label: 'Claude Messages', icon: 'code', description: '/messages', method: 'POST' },
      { id: 'text-gemini', label: 'Gemini 原生', icon: 'code', description: '/v1beta/models/{model}:generateContent', method: 'POST' },
      { id: 'text-models', label: '模型差异表', icon: 'list', description: '上下文、能力与计费对照' },
    ],
  },
  {
    label: '图片模型',
    items: [
      { id: 'image-generation', label: '图片接口通用说明', icon: 'image-generation', description: '/images/generations', method: 'POST' },
      { id: 'image-gpt-image-2', label: 'gpt-image-2', icon: 'image-generation', description: '1K · 基础款', method: 'POST' },
      { id: 'image-gpt-image-25', label: 'gpt-image-2.5', icon: 'image-generation', description: '1K · 基础款', method: 'POST' },
      { id: 'image-gpt-image-vip', label: 'gpt-image-2-vip', icon: 'image-generation', description: '1K–4K · medium', method: 'POST' },
      { id: 'image-gpt-image-flare', label: 'gpt-image-2.5-flare', icon: 'image-generation', description: '1K–4K · 三档质量', method: 'POST' },
      { id: 'image-gpt-image-sunburst', label: 'gpt-image-2.5-sunburst', icon: 'image-generation', description: '1K–4K · 五档质量', method: 'POST' },
      { id: 'image-edit', label: '编辑图片', icon: 'image-edit', description: '/images/edits', method: 'POST' },
    ],
  },
  {
    label: '视频模型',
    items: [
      { id: 'video-generation', label: '视频任务通用说明', icon: 'video', description: '/videos', method: 'POST' },
      { id: 'video-minimax-h3', label: 'minimax-h3', icon: 'video', description: '480p–1080p · 1–15 秒', method: 'POST' },
      { id: 'video-result', label: '查询任务结果', icon: 'video', description: '/videos/{id}', method: 'GET' },
      { id: 'video-async', label: '通用异步生成', icon: 'video', description: '/api/generate 与 /api/result', method: 'POST' },
    ],
  },
  {
    label: '通用说明',
    items: [
      { id: 'streaming', label: '流式响应', icon: 'streaming', description: '文本与图片的 SSE 事件' },
      { id: 'models', label: '模型列表', icon: 'list', description: '/models', method: 'GET' },
      { id: 'errors', label: '错误处理', icon: 'errors', description: '状态码、错误结构与重试' },
      { id: 'integration', label: '客户端接入', icon: 'plug', description: 'Base URL、常见工具与限制' },
    ],
  },
]

/**
 * Anchors published before the docs were split by capability. Keep them working
 * so existing links (for example DocsView's "查看参数与调用示例") never land on
 * the overview instead of the section they promised.
 */
const legacySectionAliases: Record<string, DocSection> = {
  'media-generation': 'video-generation',
}

const navigationItems = navigationGroups.flatMap((group) => group.items)
const activeNavigationItem = computed(() =>
  navigationItems.find((item) => item.id === activeSection.value) ?? navigationItems[0]!,
)
const activeGroupLabel = computed(() =>
  navigationGroups.find((group) => group.items.some((item) => item.id === activeSection.value))?.label ?? 'API 文档',
)
const activeIndex = computed(() => navigationItems.findIndex((item) => item.id === activeSection.value))
const previousItem = computed(() => navigationItems[activeIndex.value - 1] ?? null)
const nextItem = computed(() => navigationItems[activeIndex.value + 1] ?? null)

const filteredNavigationGroups = computed(() => {
  const query = docsSearch.value.trim().toLowerCase()
  if (!query) return navigationGroups
  return navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${group.label} ${item.label} ${item.description}`.toLowerCase().includes(query),
      ),
    }))
    .filter((group) => group.items.length > 0)
})

const generationParameters: ParameterRow[] = [
  { name: 'model', type: 'string', required: true, defaultValue: '—', description: '图片模型：gpt-image-2、gpt-image-2-vip、gpt-image-2.5、gpt-image-2.5-flare、gpt-image-2.5-sunburst。' },
  { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '描述目标图片的提示词，最长 10 万字符。' },
  { name: 'size', type: 'string', required: false, defaultValue: 'auto', description: '基础款支持 auto、比例（如 16:9）或 1K 像素值；VIP / Flare / Sunburst 支持 1K–4K 像素值，宽高比不超过 3:1，像素值须为 16 的倍数。' },
  { name: 'quality', type: 'string', required: false, defaultValue: '模型默认', description: 'gpt-image-2 与 2.5 仅 auto；vip 仅 medium；flare 支持 low / medium / high；sunburst 另有 xhigh / max。' },
  { name: 'background', type: 'string', required: false, defaultValue: 'auto', description: 'auto、opaque 或 transparent；基础款不支持透明背景。' },
  { name: 'n', type: 'integer', required: false, defaultValue: '1', description: '固定为 1，批量出图请提交多个请求；n 大于 1 会返回 400。' },
  { name: 'response_format', type: 'string', required: false, defaultValue: 'b64_json', description: 'url 直接返回图片地址；b64_json 由平台代下载后返回 Base64，图片地址不可访问时会报 502。' },
  { name: 'stream', type: 'boolean', required: false, defaultValue: 'false', description: '开启后以 SSE 返回最终 image_generation.completed / image_edit.completed 事件，不含中间图。' },
  { name: 'output_format / output_compression / partial_images / moderation / input_fidelity / style / file_id', type: '—', required: false, defaultValue: '—', description: '暂不支持，提交时直接返回参数错误。' },
]

const editParameters: ParameterRow[] = [
  { name: 'image', type: 'file | string', required: true, defaultValue: '—', description: '待编辑图片：multipart 文件、HTTP(S) 图片地址或 base64 data URL。' },
  { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '说明需要进行的图片修改。' },
  { name: 'mask', type: 'file | string', required: false, defaultValue: '—', description: '可选遮罩图，支持 multipart 文件、图片地址或 data URL；JSON 方式只支持 mask.image_url。' },
  { name: 'model', type: 'string', required: false, defaultValue: '—', description: '同生成接口的模型列表。' },
  { name: 'size', type: 'string', required: false, defaultValue: 'auto', description: '输出尺寸，约束与生成接口一致。' },
  { name: 'quality / background', type: 'string', required: false, defaultValue: '模型默认', description: '同上；基础款只支持 auto，VIP 只支持 medium。' },
  { name: 'response_format', type: 'string', required: false, defaultValue: 'b64_json', description: '可选 b64_json 或 url。' },
  { name: 'stream', type: 'boolean', required: false, defaultValue: 'false', description: '是否使用 SSE 返回最终结果。' },
]

const generationCurl = computed(() => [
  `curl ${apiBaseUrl.value}/images/generations \\`,
  '  -H "Authorization: Bearer mb-xxxxxxxx" \\',
  '  -H "Content-Type: application/json" \\',
  `  -d '{
    "model": "gpt-image-2.5",
    "prompt": "一只坐在窗边的橘猫，午后阳光，写实摄影风格",
    "size": "1024x1024",
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
  "    model: 'gpt-image-2.5',",
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
  "created": 1791003279,
  "data": [{ "url": "https://file8.aitohumanize.com/file/2b45e0c3cbbe42f6bb333bd96370634f.png" }],
  "usage": { "image_count": 1 }
}`

const generationResponseBase64 = `{
  "created": 1791003279,
  "data": [{ "b64_json": "iVBORw0KGgoAAAANSUhEUg..." }],
  "usage": { "image_count": 1 }
}`

const editCurl = computed(() => [
  `curl ${apiBaseUrl.value}/images/edits \\`,
  '  -H "Authorization: Bearer mb-xxxxxxxx" \\',
  '  -F "model=gpt-image-2.5" \\',
  '  -F "prompt=把天空替换成极光，保留前景建筑" \\',
  '  -F "response_format=url" \\',
  '  -F "image=@./source.png"',
].join('\n'))

const editJavaScript = computed(() => [
  'const form = new FormData()',
  "form.append('model', 'gpt-image-2.5')",
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

// ── 文本模型示例 ────────────────────────────────────────────
const chatCurl = computed(() => `curl ${apiBaseUrl.value}/chat/completions \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-6.1-sol",
    "messages": [{"role": "user", "content": "用三句话介绍 Model Bridge"}],
    "stream": false
  }'`)

const chatResponse = `{
  "id": "chatcmpl-9f2c1a",
  "object": "chat.completion",
  "created": 1791003279,
  "model": "gpt-6.1-sol",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "Model Bridge 是一个统一入口…" },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 18, "completion_tokens": 96, "total_tokens": 114 }
}`

const chatStreamCurl = computed(() => `curl -N ${apiBaseUrl.value}/chat/completions \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"claude-sonnet-5","messages":[{"role":"user","content":"写一句诗"}],"stream":true}'`)

const messagesCurl = computed(() => `curl ${apiBaseUrl.value}/messages \\
  -H "x-api-key: mb-xxxxxxxx" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-5",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "用一句话解释什么是反向代理"}]
  }'`)

const messagesResponse = `{
  "id": "msg_01XyZ",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-5",
  "content": [{ "type": "text", "text": "反向代理是位于客户端与真实服务器之间的中间层…" }],
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 24, "output_tokens": 118 }
}`

const geminiCurl = computed(() => `curl "${baseOrigin.value}/v1beta/models/gemini-3.8-flash:generateContent" \\
  -H "x-goog-api-key: mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{ "parts": [{ "text": "用一句话介绍你自己" }] }]
  }'`)

const videoResponse = `{
  "id": "media_eebcf2b5-e77d-48bf-8680-6ad537c3c266",
  "object": "video",
  "model": "minimax-h3",
  "status": "running",
  "progress": 0,
  "results": [],
  "duration": 5,
  "resolution": "480p",
  "aspectRatio": "landscape",
  "created_at": 1791003537
}`

const videoResultCurl = computed(() => `curl ${baseOrigin.value}/api/media/v1/videos/media_eebcf2b5-e77d-48bf-8680-6ad537c3c266 \\
  -H "Authorization: Bearer mb-xxxxxxxx"`)

const videoResultResponse = `{
  "id": "media_eebcf2b5-e77d-48bf-8680-6ad537c3c266",
  "object": "video",
  "model": "minimax-h3",
  "status": "succeeded",
  "progress": 100,
  "results": [{ "url": "https://file1.aitohumanize.com/file/49edf1169ee44943acb5dc0d64b648e1.mp4" }],
  "duration": 1,
  "resolution": "480p",
  "aspectRatio": "landscape",
  "created_at": 1791003537
}`

const videoPollScript = `import time, requests

BASE, KEY = "https://your-host/api/media/v1", "mb-xxxxxxxx"
H = {"Authorization": f"Bearer {KEY}"}

task = requests.post(f"{BASE}/videos", headers=H, json={
    "model": "minimax-h3", "prompt": "电影镜头：橘猫走过雨后的花园",
    "aspectRatio": "landscape", "resolution": "480p", "duration": 5}).json()
print("任务:", task["id"], task["status"])

while True:
    time.sleep(5)
    result = requests.get(f"{BASE}/videos/{task['id']}", headers=H).json()
    print("状态:", result["status"], result.get("progress"))
    if result["status"] in ("succeeded", "failed", "violation"):
        print("结果:", result.get("results") or result.get("error"))
        break`

const asyncGenerateCurl = computed(() => `curl ${baseOrigin.value}/api/media/v1/api/generate \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"minimax-h3","prompt":"橘猫在窗台打盹","aspectRatio":"landscape","resolution":"480p","duration":5,"replyType":"async"}'

# 查询：id 为提交返回的本平台任务 id
curl "${baseOrigin.value}/api/media/v1/api/result?id=media_TASK_ID" \\
  -H "Authorization: Bearer mb-xxxxxxxx"`)

const modelsResponse = `{
  "object": "list",
  "data": [
    { "id": "claude-sonnet-5", "object": "model", "owned_by": "claude", "type": "model", "display_name": "Claude Sonnet 5" },
    { "id": "gpt-6.1-sol", "object": "model", "owned_by": "openai", "type": "model", "display_name": "GPT-6.1 Sol" },
    { "id": "gpt-image-2.5", "object": "model", "owned_by": "modelbridge", "type": "model", "display_name": "GPT Image 2.5" },
    { "id": "minimax-h3", "object": "model", "owned_by": "modelbridge", "type": "model", "display_name": "MiniMax H3" }
  ]
}`

interface IntegrationRow {
  tool: string
  baseUrl: string
  model: string
  note: string
}

const integrationRows: IntegrationRow[] = [
  { tool: 'OpenAI 兼容客户端（ChatGPT 类、Cherry Studio、Open WebUI、Dify 等）', baseUrl: 'https://your-host/v1', model: 'gpt-6.1-sol、claude-sonnet-5 等', note: '填 OpenAI 协议即可，平台按模型自动路由到对应上游。' },
  { tool: 'Claude Code / Anthropic SDK', baseUrl: 'https://your-host', model: 'claude-sonnet-5、claude-opus-5', note: 'ANTHROPIC_BASE_URL 指向本平台，Key 用 ANTHROPIC_AUTH_TOKEN 传入。' },
  { tool: 'Codex CLI / OpenAI Responses 客户端', baseUrl: 'https://your-host/v1', model: 'gpt-6.1-sol、gpt-6-astra', note: '使用 /v1/responses，兼容 Codex 的模型清单请求。' },
  { tool: 'Gemini SDK / google-genai', baseUrl: 'https://your-host', model: 'gemini-3.8-flash、gemini-3.1-pro-preview', note: '走 /v1beta/models/{model}:generateContent，用 x-goog-api-key 鉴权。' },
  { tool: '图片客户端（Python OpenAI SDK、绘图前端、ComfyUI 图像节点）', baseUrl: 'https://your-host/api/media/v1 或 https://your-host/v1', model: 'gpt-image-2.5、gpt-image-2-vip 等', note: '图片必须走 images 接口；模型权限需包含图片 / 视频。' },
  { tool: '视频脚本 / 后端任务队列', baseUrl: 'https://your-host/api/media/v1', model: 'minimax-h3', note: '视频是异步任务：先 POST /videos，再轮询 /videos/{id}。' },
]

/** Text models that callers ask about most; the plaza lists the full catalog. */
const textModelRows = [
  { model: 'claude-sonnet-5', vendor: 'Anthropic', context: '1M', tools: '支持', reasoning: '思考预算', vision: '支持', price: '$2 / $10' },
  { model: 'claude-opus-5', vendor: 'Anthropic', context: '1M', tools: '支持', reasoning: '思考预算', vision: '支持', price: '$5 / $25' },
  { model: 'gpt-6.1-sol', vendor: 'OpenAI', context: '1.05M', tools: '支持', reasoning: 'reasoning_effort', vision: '支持', price: '$2 / $10' },
  { model: 'gemini-3.8-flash', vendor: 'Google', context: '1M', tools: '支持', reasoning: '思考预算', vision: '支持', price: '$0.75 / $3.75' },
  { model: 'deepseek-v4-pro', vendor: 'DeepSeek', context: '1M', tools: '支持', reasoning: '深度推理档', vision: '不支持', price: '$0.435 / $0.87' },
  { model: 'glm-5.3', vendor: 'Zhipu', context: '1M', tools: '支持', reasoning: '思考模式', vision: '不支持', price: '$1.12 / $3.92' },
  { model: 'qwen3.8-max', vendor: 'Alibaba', context: '1M', tools: '支持', reasoning: '思考模式', vision: '原生视觉', price: '$1.68 / $5.04' },
  { model: 'kimi-k3', vendor: 'Moonshot', context: '1M', tools: '支持', reasoning: '默认开启', vision: '不支持', price: '$2.8 / $14' },
  { model: 'MiniMax-M3', vendor: 'MiniMax', context: '1M', tools: '支持', reasoning: '可选思考', vision: '支持', price: '$0.3 / $1.2' },
  { model: 'grok-4.7', vendor: 'xAI', context: '500K', tools: '支持', reasoning: '思考档位', vision: '图像输入', price: '$2 / $6' },
]

/** Per-model pages for image generation; order matches the sidebar. */
const imageModelDocs: MediaModelDoc[] = [
  {
    section: 'image-gpt-image-2', modelId: 'gpt-image-2', label: 'gpt-image-2',
    summary: '基础款图片模型，性价比最高，只输出 1K 图片。',
    endpoint: '/api/media/v1/images/generations',
    params: [
      { name: 'model', type: 'string', required: true, defaultValue: '—', description: '固定为 gpt-image-2。' },
      { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '提示词，最长 10 万字符。' },
      { name: 'size', type: 'string', required: false, defaultValue: 'auto', description: 'auto、比例（16:9 等）或 1K 像素值；像素总数不超过 2,097,152，宽高比不超过 3:1。' },
      { name: 'quality', type: 'string', required: false, defaultValue: 'auto', description: '只支持 auto，传其它值返回 400。' },
      { name: 'background', type: 'string', required: false, defaultValue: 'auto', description: 'auto 或 opaque；不支持 transparent。' },
      { name: 'response_format', type: 'string', required: false, defaultValue: 'b64_json', description: 'url 或 b64_json。' },
      { name: 'stream', type: 'boolean', required: false, defaultValue: 'false', description: 'SSE 返回最终结果。' },
    ],
    traits: [
      { name: '分辨率', value: '1K（1024×1024 等）' },
      { name: '质量档', value: 'auto' },
      { name: '透明背景', value: '不支持' },
      { name: '参考图编辑', value: '走 /images/edits' },
    ],
    pricing: '按成功生成的次数计费，失败与违规不计费。',
    example: `curl ${baseOrigin.value}/api/media/v1/images/generations \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只坐在窗边的橘猫，午后阳光，写实摄影风格",
    "size": "1024x1024",
    "response_format": "url"
  }'`,
    notes: ['如果提示只支持 1K，说明尺寸超过了基础款上限：改用 gpt-image-2-vip、flare 或 sunburst。'],
  },
  {
    section: 'image-gpt-image-25', modelId: 'gpt-image-2.5', label: 'gpt-image-2.5',
    summary: 'gpt-image-2 的同代升级款，参数契约与基础款一致，画质与指令跟随更好。',
    endpoint: '/api/media/v1/images/generations',
    params: [
      { name: 'model', type: 'string', required: true, defaultValue: '—', description: '固定为 gpt-image-2.5。' },
      { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '提示词，最长 10 万字符。' },
      { name: 'size', type: 'string', required: false, defaultValue: 'auto', description: '与 gpt-image-2 相同：auto、比例或 1K 像素值。' },
      { name: 'quality', type: 'string', required: false, defaultValue: 'auto', description: '只支持 auto。' },
      { name: 'background', type: 'string', required: false, defaultValue: 'auto', description: 'auto 或 opaque；不支持 transparent。' },
      { name: 'response_format / stream', type: '—', required: false, defaultValue: 'b64_json / false', description: '与基础款一致。' },
    ],
    traits: [
      { name: '分辨率', value: '1K' },
      { name: '质量档', value: 'auto' },
      { name: '相对 2.0', value: '画质与文字渲染更好' },
      { name: '参考图编辑', value: '走 /images/edits' },
    ],
    pricing: '按次计费，与 gpt-image-2 同价。',
    example: `curl ${baseOrigin.value}/api/media/v1/images/generations \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-image-2.5","prompt":"雨夜霓虹街道，电影感","size":"1024x1024","response_format":"url"}'`,
  },
  {
    section: 'image-gpt-image-vip', modelId: 'gpt-image-2-vip', label: 'gpt-image-2-vip',
    summary: '高分辨率款：支持 1K–4K 与透明背景，质量档固定 medium。',
    endpoint: '/api/media/v1/images/generations',
    params: [
      { name: 'model', type: 'string', required: true, defaultValue: '—', description: '固定为 gpt-image-2-vip。' },
      { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '提示词。' },
      { name: 'size', type: 'string', required: false, defaultValue: 'auto', description: '必须是精确像素值 `宽x高`（如 2048x2048），宽高须为 16 的倍数，单边不超过 3840，宽高比不超过 3:1。' },
      { name: 'quality', type: 'string', required: false, defaultValue: 'medium', description: '只支持 medium。' },
      { name: 'background', type: 'string', required: false, defaultValue: 'auto', description: '支持 transparent（透明背景）。' },
      { name: 'response_format / stream', type: '—', required: false, defaultValue: 'b64_json / false', description: '与基础款一致。' },
    ],
    traits: [
      { name: '分辨率', value: '1K–4K' },
      { name: '质量档', value: 'medium' },
      { name: '透明背景', value: '支持' },
      { name: 'size 写法', value: '精确像素值，不接受 16:9 这类比例' },
    ],
    pricing: '按次计费，单价比基础款高。',
    example: `curl ${baseOrigin.value}/api/media/v1/images/generations \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-image-2-vip","prompt":"产品级静物摄影，白色背景","size":"2048x2048","quality":"medium","background":"transparent","response_format":"url"}'`,
  },
  {
    section: 'image-gpt-image-flare', modelId: 'gpt-image-2.5-flare', label: 'gpt-image-2.5-flare',
    summary: '2.5 代高分辨率款，支持三档质量与透明背景。',
    endpoint: '/api/media/v1/images/generations',
    params: [
      { name: 'model', type: 'string', required: true, defaultValue: '—', description: '固定为 gpt-image-2.5-flare。' },
      { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '提示词。' },
      { name: 'size', type: 'string', required: false, defaultValue: 'auto', description: '精确像素值 `宽x高`，1K–4K，宽高为 16 的倍数。' },
      { name: 'quality', type: 'string', required: false, defaultValue: '模型默认', description: 'low、medium 或 high。' },
      { name: 'background', type: 'string', required: false, defaultValue: 'auto', description: '支持 transparent。' },
      { name: 'response_format / stream', type: '—', required: false, defaultValue: 'b64_json / false', description: '与基础款一致。' },
    ],
    traits: [
      { name: '分辨率', value: '1K–4K' },
      { name: '质量档', value: 'low / medium / high' },
      { name: '透明背景', value: '支持' },
      { name: '与 vip 的区别', value: '质量可选，代次更新' },
    ],
    pricing: '按次计费，与 vip 同档。',
    example: `curl ${baseOrigin.value}/api/media/v1/images/generations \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-image-2.5-flare","prompt":"科幻城市夜景，超广角","size":"2560x1440","quality":"high","response_format":"url"}'`,
  },
  {
    section: 'image-gpt-image-sunburst', modelId: 'gpt-image-2.5-sunburst', label: 'gpt-image-2.5-sunburst',
    summary: '质量档最全的型号：在 flare 基础上多出 xhigh 与 max，适合终稿出图。',
    endpoint: '/api/media/v1/images/generations',
    params: [
      { name: 'model', type: 'string', required: true, defaultValue: '—', description: '固定为 gpt-image-2.5-sunburst。' },
      { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '提示词。' },
      { name: 'size', type: 'string', required: false, defaultValue: 'auto', description: '精确像素值 `宽x高`，1K–4K。' },
      { name: 'quality', type: 'string', required: false, defaultValue: '模型默认', description: 'low、medium、high、xhigh 或 max。' },
      { name: 'background', type: 'string', required: false, defaultValue: 'auto', description: '支持 transparent。' },
      { name: 'response_format / stream', type: '—', required: false, defaultValue: 'b64_json / false', description: '与基础款一致。' },
    ],
    traits: [
      { name: '分辨率', value: '1K–4K' },
      { name: '质量档', value: 'low / medium / high / xhigh / max' },
      { name: '透明背景', value: '支持' },
      { name: '适用场景', value: '终稿、需要最高细节' },
    ],
    pricing: '按次计费，四个图片型号中单价最高。',
    example: `curl ${baseOrigin.value}/api/media/v1/images/generations \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-image-2.5-sunburst","prompt":"博物馆级产品摄影","size":"2880x2880","quality":"max","response_format":"url"}'`,
    notes: ['质量档越高越慢，批量出图建议先用低档确认构图，再用高档出终稿。'],
  },
]

/** Per-model pages for video; each vendor invents its own parameter set. */
const videoModelDocs: MediaModelDoc[] = [
  {
    section: 'video-minimax-h3', modelId: 'minimax-h3', label: 'minimax-h3',
    summary: '当前唯一支持的视频模型：文生视频，可选参考图与参考音频，按分辨率与秒数计费。',
    endpoint: '/api/media/v1/videos',
    params: [
      { name: 'model', type: 'string', required: true, defaultValue: '—', description: '固定为 minimax-h3。' },
      { name: 'prompt', type: 'string', required: true, defaultValue: '—', description: '描述场景、镜头运动与声音。' },
      { name: 'aspectRatio', type: 'string', required: true, defaultValue: '—', description: 'landscape 或 portrait；传 16:9 这类比例会返回 400。' },
      { name: 'resolution', type: 'string', required: true, defaultValue: '—', description: '480p、768p 或 1080p。' },
      { name: 'duration', type: 'integer', required: true, defaultValue: '—', description: '1–15 秒；1080p 最多 10 秒。' },
      { name: 'images', type: 'string[]', required: false, defaultValue: '—', description: '最多 9 张参考图，HTTP(S) 地址或 base64 data URL。' },
      { name: 'audios', type: 'string[]', required: false, defaultValue: '—', description: '最多 3 段参考音频，HTTP(S) 地址或 base64 data URL。' },
      { name: 'seed', type: 'integer', required: false, defaultValue: '—', description: '随机种子，用于复现同一结果。' },
    ],
    traits: [
      { name: '分辨率', value: '480p / 768p / 1080p' },
      { name: '时长', value: '1–15 秒（1080p ≤10 秒）' },
      { name: '参考素材', value: '≤9 张图、≤3 段音频' },
      { name: '计费', value: '分辨率 × 秒数' },
      { name: '典型耗时', value: '5 秒 480p 约 1–2 分钟' },
    ],
    pricing: '按「分辨率 × 生成秒数」计费，受理时冻结价格，成功后才结算；失败或违规不扣费。',
    example: `curl ${baseOrigin.value}/api/media/v1/videos \\
  -H "Authorization: Bearer mb-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "minimax-h3",
    "prompt": "电影镜头：橘猫走过雨后的花园，镜头缓慢推进",
    "aspectRatio": "landscape",
    "resolution": "480p",
    "duration": 5
  }'`,
    notes: [
      '图片专用参数（quality、background、mask）在视频请求里会返回 400。',
      '上游额度不足时任务会立刻失败并返回 insufficient credits，这种情况不扣费。',
    ],
  },
]

const activeImageModel = computed(() => imageModelDocs.find((doc) => doc.section === activeSection.value) ?? null)
const activeVideoModel = computed(() => videoModelDocs.find((doc) => doc.section === activeSection.value) ?? null)


const streamCurl = computed(() => [
  `curl -N ${baseOrigin.value}/api/media/v1/images/generations \\`,
  '  -H "Authorization: Bearer mb-xxxxxxxx" \\',
  '  -H "Content-Type: application/json" \\',
  `  -d '{
    "model": "gpt-image-2.5",
    "prompt": "未来城市夜景",
    "stream": true,
    "response_format": "url"
  }'`,
].join('\n'))

const streamResponse = `event: image_generation.completed
data: {"type":"image_generation.completed","url":"https://file8.aitohumanize.com/file/2b45e0c3cbbe42f6bb333bd96370634f.png","image_index":0,"model":"gpt-image-2.5","created_at":1791003279,"usage":{"image_count":1}}`

const textStreamResponse = `data: {"id":"chatcmpl-9f2c1a","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Model"},"finish_reason":null}]}

data: {"id":"chatcmpl-9f2c1a","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" Bridge"},"finish_reason":null}]}

data: {"id":"chatcmpl-9f2c1a","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":96,"total_tokens":114}}

data: [DONE]`

/** Resolves a URL hash to a live section, following legacy anchors when needed. */
function resolveSection(value: string): DocSection | null {
  if (navigationItems.some((item) => item.id === value)) return value as DocSection
  return legacySectionAliases[value] ?? null
}

function syncSectionFromHash(): void {
  const section = resolveSection(window.location.hash.slice(1))
  if (section) activeSection.value = section
}

function selectSection(section: DocSection): void {
  activeSection.value = section
  docsSearch.value = ''
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${section}`)
  document.querySelector('.docs-article')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleMobileSection(event: Event): void {
  const section = resolveSection((event.target as HTMLSelectElement).value)
  if (section) selectSection(section)
}

function openAuthorization(): void {
  authorizationRef.value?.open()
}

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

onMounted(() => {
  previousDocumentTitle = document.title
  document.title = 'API 文档 | Model Bridge'
  syncSectionFromHash()
  window.addEventListener('hashchange', syncSectionFromHash)
})
onBeforeUnmount(() => {
  document.title = previousDocumentTitle
  window.removeEventListener('hashchange', syncSectionFromHash)
})
</script>

<template>
  <div class="docs-page">
    <a class="docs-skip-link" href="#api-doc-content">跳到文档正文</a>
    <header class="docs-topbar">
      <div class="docs-topbar-inner">
        <RouterLink to="/" class="docs-brand" aria-label="返回 Model Bridge 首页">
          <BrandLogo :size="32" />
          <strong>Model Bridge</strong>
          <span>API 文档</span>
        </RouterLink>
        <nav class="docs-top-actions" aria-label="页面导航">
          <RouterLink to="/">首页</RouterLink>
          <ApiDocsAuthorization ref="authorizationRef" v-model:api-key="testerApiKey" />
          <RouterLink :to="consoleEntry.to" class="docs-console-link" :title="consoleEntry.title">{{ consoleEntry.label }}</RouterLink>
        </nav>
      </div>
    </header>

    <div class="docs-page-content">
      <div class="docs-layout" :class="docsSidebarCollapsed ? 'docs-layout-collapsed' : 'docs-layout-expanded'">
        <aside class="docs-sidebar" aria-label="API 文档目录">
          <div class="docs-sidebar-inner">
            <div class="docs-sidebar-toolbar">
              <label class="docs-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35m2.1-5.4a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
                </svg>
                <input v-model="docsSearch" type="search" placeholder="搜索文档" />
              </label>
              <button
                type="button"
                class="docs-collapse-button"
                :aria-label="docsSidebarCollapsed ? '展开 API 文档目录' : '收起 API 文档目录'"
                :title="docsSidebarCollapsed ? '展开文档目录' : '收起文档目录'"
                @click="toggleDocsSidebarCollapsed"
              >
                <svg :class="docsSidebarCollapsed && 'rotate-180'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6" />
                </svg>
              </button>
            </div>

            <nav class="docs-nav">
          <div v-for="group in filteredNavigationGroups" :key="group.label" class="docs-nav-group">
            <p>{{ group.label }}</p>
            <button
              v-for="item in group.items"
              :key="item.id"
              type="button"
              :class="['docs-nav-item', activeSection === item.id && 'docs-nav-item-active']"
              :aria-current="activeSection === item.id ? 'page' : undefined"
              :title="docsSidebarCollapsed ? item.label : undefined"
              @click="selectSection(item.id)"
            >
              <span class="docs-nav-symbol" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
                  <path
                    v-for="path in docsIconPaths[item.icon]"
                    :key="path"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    :d="path"
                  />
                </svg>
              </span>
              <span class="docs-nav-copy">
                <span class="docs-nav-label">
                  <span>{{ item.label }}</span>
                  <span v-if="item.method" class="nav-method">{{ item.method }}</span>
                </span>
                <small>{{ item.description }}</small>
              </span>
            </button>
          </div>
          <p v-if="filteredNavigationGroups.length === 0" class="docs-empty">没有匹配的文档</p>
            </nav>

            <div class="docs-base-url">
          <span>Base URL</span>
          <button type="button" title="复制 Base URL" @click="copy(apiBaseUrl)">
            <code>{{ apiBaseUrl }}</code>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v1.125c0 .621-.504 1.125-1.125 1.125h-9.75A1.125 1.125 0 0 1 3.75 18.375v-9.75c0-.621.504-1.125 1.125-1.125H6m9.75 9.75h3.375c.621 0 1.125-.504 1.125-1.125v-9.75c0-.621-.504-1.125-1.125-1.125h-9.75c-.621 0-1.125.504-1.125 1.125V7.5m7.5 9.75h-7.5V7.5" />
            </svg>
          </button>
            </div>
          </div>
        </aside>

        <main id="api-doc-content" class="docs-main">
      <label class="docs-mobile-nav">
        <span>文档目录</span>
        <select :value="activeSection" @change="handleMobileSection">
          <optgroup v-for="group in navigationGroups" :key="group.label" :label="group.label">
            <option v-for="item in group.items" :key="item.id" :value="item.id">{{ item.label }}</option>
          </optgroup>
        </select>
      </label>

      <article class="docs-article">
        <header class="article-header">
          <p class="article-kicker">{{ activeGroupLabel }} <span>/</span> {{ activeNavigationItem.label }}</p>
          <div class="article-title-row">
            <div>
              <h1>{{ activeNavigationItem.label }}</h1>
              <p>{{ activeNavigationItem.description }}</p>
            </div>
            <UiTag v-if="activeNavigationItem.method" :type="activeNavigationItem.method === 'GET' ? 'info' : 'success'">{{ activeNavigationItem.method }}</UiTag>
          </div>
        </header>

        <section v-if="activeSection === 'overview'" class="article-body">
          <div class="lead-copy">
            <h2>一个 Base URL 调用文本、图片与视频模型</h2>
            <p>Model Bridge 把多家上游聚合到同一套 HTTP 接口：文本走 OpenAI / Anthropic / Gemini 兼容协议，图片走 OpenAI Images 协议，视频走异步任务接口。账号调度、API Key 权限、额度与用量统计全部在转发前统一处理。</p>
          </div>

          <div class="status-line">
            <span class="status-dot" />
            <strong>三类能力已就绪</strong>
            <span>文本 · 图片 · 视频</span>
            <code>{{ apiBaseUrl }}</code>
          </div>

          <section class="article-section">
            <h2>快速开始</h2>
            <ol class="start-list">
              <li><span>01</span><div><strong>创建平台 API Key</strong><p>在控制台创建 <code>mb-</code> 开头的密钥，按需勾选服务商范围（文本模型、图片 / 视频）与模型白名单。</p></div></li>
              <li><span>02</span><div><strong>设置 Base URL 与鉴权</strong><p>文本与图片填 <code>{{ apiBaseUrl }}</code>，图片 / 视频也可填 <code>{{ baseOrigin }}/api/media/v1</code>；鉴权用 <code>Authorization: Bearer</code>（Gemini 可用 <code>x-goog-api-key</code>）。</p></div></li>
              <li><span>03</span><div><strong>按能力发第一条请求</strong><p>文本 <code>POST /v1/chat/completions</code>；图片 <code>POST /v1/images/generations</code>；视频 <code>POST /api/media/v1/videos</code> 后轮询结果。</p></div></li>
            </ol>
          </section>

          <section class="article-section">
            <h2>可用接口</h2>
            <div class="endpoint-list">
              <button type="button" @click="selectSection('text-chat')">
                <span class="method-post">POST</span><code>/v1/chat/completions</code><span>文本对话，OpenAI 兼容</span><b>→</b>
              </button>
              <button type="button" @click="selectSection('text-messages')">
                <span class="method-post">POST</span><code>/v1/messages</code><span>Claude Messages 兼容</span><b>→</b>
              </button>
              <button type="button" @click="selectSection('text-gemini')">
                <span class="method-post">POST</span><code>/v1beta/models/…:generateContent</code><span>Gemini 原生协议</span><b>→</b>
              </button>
              <button type="button" @click="selectSection('image-generation')">
                <span class="method-post">POST</span><code>/v1/images/generations</code><span>根据提示词生成图片</span><b>→</b>
              </button>
              <button type="button" @click="selectSection('image-edit')">
                <span class="method-post">POST</span><code>/v1/images/edits</code><span>上传并编辑图片</span><b>→</b>
              </button>
              <button type="button" @click="selectSection('video-generation')">
                <span class="method-post">POST</span><code>/api/media/v1/videos</code><span>提交视频任务（异步）</span><b>→</b>
              </button>
              <button type="button" @click="selectSection('models')">
                <span class="method-post">GET</span><code>/v1/models</code><span>按 Key 权限列出可用模型</span><b>→</b>
              </button>
            </div>
          </section>

          <section class="article-section">
            <h2>计费口径</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>能力</th><th>计费方式</th><th>说明</th></tr></thead><tbody>
              <tr><td>文本</td><td>按输入 / 输出 Token</td><td>价格随模型档位与缓存读写区分，用量来自上游返回。</td></tr>
              <tr><td>图片</td><td>按成功生成的次数</td><td>一次请求一张图；失败或违规不计费。</td></tr>
              <tr><td>视频</td><td>按分辨率 × 生成秒数</td><td>受理时冻结价格，成功后才结算；重复查询不重复计费。</td></tr>
            </tbody></table></div>
          </section>

          <UiAlert type="info" title="两种图片地址都可用">
            <code>{{ baseOrigin }}/api/media/v1/images/...</code> 与标准 <code>{{ apiBaseUrl }}/images/...</code> 等价；前者始终选择图片 / 视频渠道，后者按 Key 权限与模型自动选路，推荐在同时开通了文本与图片权限时使用前者。
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'authentication'" class="article-body">
          <div class="lead-copy">
            <h2>使用 Bearer Token 认证</h2>
            <p>所有图片 API 请求都必须携带有效的平台 API Key。密钥状态、用户余额、服务商范围、模型白名单、速率和并发限制会在请求转发前统一校验。</p>
          </div>

          <section class="article-section">
            <h2>请求头</h2>
            <div class="code-shell">
              <button type="button" class="copy-code" @click="copy('Authorization: Bearer mb-xxxxxxxx')">复制</button>
              <pre><code>Authorization: Bearer mb-xxxxxxxx</code></pre>
            </div>
          </section>

          <section class="article-section">
            <h2>密钥安全</h2>
            <div class="security-list">
              <div><strong>服务端调用</strong><p>把 Key 放入环境变量或密钥管理系统，不要提交到 Git。</p></div>
              <div><strong>登录用户前端</strong><p>允许用户输入自己的 Key，避免共享一个固定平台密钥。</p></div>
              <div><strong>匿名公网前端</strong><p>由业务后端保管 Key 并代理请求，同时增加用户鉴权、限流和提示词长度限制。</p></div>
            </div>
          </section>

          <UiAlert type="warning" title="不要暴露固定密钥">
            浏览器代码、Source Map 和网络请求都可能暴露写死在前端的 API Key。跨域页面还需要在反向代理中按可信来源配置 CORS，避免使用无条件的通配来源。
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'text-chat'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ apiBaseUrl }}/chat/completions</code>
            <UiButton size="tiny" secondary @click="copy(`${apiBaseUrl}/chat/completions`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">OpenAI Chat Completions 兼容接口，按 <code>model</code> 自动路由到对应上游：<code>gpt-*</code> 走 OpenAI、<code>claude-*</code> 走 Claude、<code>gemini-*</code> 走 Gemini，其余前缀走各自的国内渠道。请求体与响应体保持 OpenAI 结构，可直接替换 Base URL 使用现有 SDK。</p>

          <section class="article-section">
            <h2>常用参数</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>
              <tr><td><code>model</code></td><td>string</td><td><span class="required">是</span></td><td>平台模型 id，可用 <code>GET /v1/models</code> 获取，例如 <code>gpt-6.1-sol</code>、<code>claude-sonnet-5</code>、<code>gemini-3.8-flash</code>、<code>deepseek-v4-pro</code>。</td></tr>
              <tr><td><code>messages</code></td><td>array</td><td><span class="required">是</span></td><td>标准 <code>{role, content}</code> 数组，支持 <code>system</code> / <code>user</code> / <code>assistant</code> / <code>tool</code>。</td></tr>
              <tr><td><code>stream</code></td><td>boolean</td><td><span class="optional">否</span></td><td>开启后返回 SSE 增量，见「流式响应」。</td></tr>
              <tr><td><code>max_tokens</code>、<code>temperature</code>、<code>top_p</code>、<code>stop</code></td><td>—</td><td><span class="optional">否</span></td><td>透传给上游模型，超出模型支持范围时由上游返回错误。</td></tr>
              <tr><td><code>tools</code> / <code>tool_choice</code></td><td>array</td><td><span class="optional">否</span></td><td>支持函数调用的模型可直接使用，平台原样转发。</td></tr>
              <tr><td><code>reasoning_effort</code></td><td>string</td><td><span class="optional">否</span></td><td>推理档位，支持该参数的上游生效，并计入用量统计。</td></tr>
              <tr><td>图片、音频等多模态输入</td><td>—</td><td><span class="optional">否</span></td><td>按上游能力支持 <code>image_url</code> / base64 输入，模型不支持时返回 400。</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>调用示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(chatCurl)">复制代码</button><pre><code>{{ chatCurl }}</code></pre></div>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(chatStreamCurl)">复制流式示例</button><pre><code>{{ chatStreamCurl }}</code></pre></div>
          </section>

          <section class="article-section">
            <h2>响应示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(chatResponse)">复制 JSON</button><pre><code>{{ chatResponse }}</code></pre></div>
          </section>

          <UiAlert type="info" title="渠道专用前缀">
            需要固定渠道时可用 <code>/api/openai/v1/chat/completions</code>、<code>/api/deepseek/v1/chat/completions</code>、<code>/api/qwen/v1/chat/completions</code> 等前缀；不写前缀时平台按模型自动选择。
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'text-messages'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ apiBaseUrl }}/messages</code>
            <UiButton size="tiny" secondary @click="copy(`${apiBaseUrl}/messages`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">Anthropic Messages 协议，字段与官方一致（<code>max_tokens</code> 必填、<code>system</code> 独立于 messages）。Claude Code、Anthropic SDK 只要把 Base URL 指向本平台即可复用原有代码。</p>

          <section class="article-section">
            <h2>鉴权与请求头</h2>
            <div class="code-shell">
              <button type="button" class="copy-code" @click="copy('x-api-key: mb-xxxxxxxx\nanthropic-version: 2023-06-01')">复制</button>
              <pre><code>x-api-key: mb-xxxxxxxx
anthropic-version: 2023-06-01</code></pre>
            </div>
            <p class="doc-note">也接受 <code>Authorization: Bearer mb-...</code>。不传 <code>anthropic-version</code> 时平台按 <code>2023-06-01</code> 处理；<code>anthropic-beta</code> 与 <code>anthropic-workspace-id</code> 会原样转发。</p>
          </section>

          <section class="article-section">
            <h2>可用接口</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>接口</th><th>说明</th></tr></thead><tbody>
              <tr><td><code>POST /v1/messages</code></td><td>对话与工具调用，支持 <code>stream</code>。</td></tr>
              <tr><td><code>POST /v1/messages/count_tokens</code></td><td>按上游规则估算输入 Token。</td></tr>
              <tr><td><code>POST /api/claude/v1/messages</code></td><td>固定 Claude 渠道，等价于默认路径。</td></tr>
              <tr><td><code>POST /api/claude/v1/chat/completions</code></td><td>用 OpenAI 结构调用 Claude，便于只支持 OpenAI 协议的客户端。</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>调用示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(messagesCurl)">复制代码</button><pre><code>{{ messagesCurl }}</code></pre></div>
          </section>

          <section class="article-section">
            <h2>响应示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(messagesResponse)">复制 JSON</button><pre><code>{{ messagesResponse }}</code></pre></div>
          </section>
        </section>

        <section v-else-if="activeSection === 'text-gemini'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ baseOrigin }}/v1beta/models/{model}:generateContent</code>
            <UiButton size="tiny" secondary @click="copy(`${baseOrigin}/v1beta/models/gemini-3.8-flash:generateContent`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">Google Generative Language 协议，适合 Gemini SDK、google-genai 以及需要 Gemini 原生字段（<code>contents</code>、<code>generationConfig</code>、<code>systemInstruction</code>）的调用方。平台同时提供 Gemini 风格的模型列表。</p>

          <section class="article-section">
            <h2>接口与鉴权</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>接口</th><th>说明</th></tr></thead><tbody>
              <tr><td><code>POST /v1beta/models/{model}:generateContent</code></td><td>一次性返回完整结果。</td></tr>
              <tr><td><code>POST /v1beta/models/{model}:streamGenerateContent</code></td><td>流式返回；SDK 会自动加 <code>?alt=sse</code>。</td></tr>
              <tr><td><code>POST /v1beta/models/{model}:countTokens</code></td><td>输入 Token 估算。</td></tr>
              <tr><td><code>GET /v1beta/models</code> 与 <code>GET /v1beta/models/{model}</code></td><td>Gemini 风格模型列表与单个模型信息。</td></tr>
            </tbody></table></div>
            <p class="doc-note">鉴权用 <code>x-goog-api-key: mb-xxxxxxxx</code>，也支持 <code>?key=mb-xxxxxxxx</code> 与 <code>Authorization: Bearer</code>。<code>/api/gemini/v1beta/...</code> 与 <code>/api/antigravity/v1beta/...</code> 为渠道固定前缀。</p>
          </section>

          <section class="article-section">
            <h2>调用示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(geminiCurl)">复制代码</button><pre><code>{{ geminiCurl }}</code></pre></div>
          </section>

          <UiAlert type="info" title="模型与渠道">
            Gemini 型号（<code>gemini-3.8-flash</code>、<code>gemini-3.1-pro-preview</code> 等）默认走 Google 官方渠道；如需指定其它渠道，可用带前缀的地址或为调用 Key 设置模型映射。
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'text-models'" class="article-body">
          <div class="lead-copy">
            <h2>先按协议调用，再按这张表选模型</h2>
            <p>文本模型的请求体由协议决定（OpenAI / Anthropic / Gemini），同一个协议下换模型不需要改代码；真正需要对照的是上下文长度、工具与多模态能力、推理档位和价格。</p>
          </div>

          <section class="article-section">
            <h2>常用模型对照</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>模型</th><th>厂商</th><th>上下文</th><th>工具调用</th><th>推理控制</th><th>图像输入</th><th>价格 / M（入 / 出）</th></tr></thead><tbody>
              <tr v-for="row in textModelRows" :key="row.model">
                <td><code>{{ row.model }}</code></td><td>{{ row.vendor }}</td><td>{{ row.context }}</td><td>{{ row.tools }}</td><td>{{ row.reasoning }}</td><td>{{ row.vision }}</td><td>{{ row.price }}</td>
              </tr>
            </tbody></table></div>
            <p class="doc-note">价格为平台参考价（USD / 百万 Token），实际以模型广场和调用记录为准；<code>GET /v1/models</code> 能拿到当前 Key 真正可用的完整列表。</p>
          </section>

          <section class="article-section">
            <h2>协议怎么选</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>场景</th><th>用哪个协议</th><th>原因</th></tr></thead><tbody>
              <tr><td>已有 OpenAI SDK / 客户端</td><td><code>POST /v1/chat/completions</code></td><td>所有厂商模型都能用同一结构调用，平台负责转换。</td></tr>
              <tr><td>Claude Code、Anthropic SDK、需要 thinking 与原生工具语义</td><td><code>POST /v1/messages</code></td><td>字段与 Anthropic 官方一致，能力不会被 OpenAI 结构削掉。</td></tr>
              <tr><td>Gemini SDK、需要原生 <code>contents</code> / <code>generationConfig</code></td><td><code>POST /v1beta/models/{model}:generateContent</code></td><td>保留 Google 原生字段与流式语义。</td></tr>
              <tr><td>Codex CLI 等 Responses 客户端</td><td><code>POST /v1/responses</code></td><td>支持 Responses 事件流与 Codex 的模型清单请求。</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>选用建议</h2>
            <div class="security-list">
              <div><strong>日常对话与代码</strong><p><code>claude-sonnet-5</code>、<code>gpt-6.1-sol</code>、<code>gemini-3.8-flash</code>：1M 上下文、价格适中，适合绝大多数请求。</p></div>
              <div><strong>复杂推理与 Agent</strong><p><code>claude-opus-5</code>、<code>glm-5.3</code>、<code>grok-4.7</code>：多步工具调用和长链路任务更稳。</p></div>
              <div><strong>成本敏感</strong><p><code>MiniMax-M3</code>、<code>deepseek-v4-pro</code>：单价最低，适合批量处理与内部任务。</p></div>
              <div><strong>长文档与视觉</strong><p><code>qwen3.8-max</code>、<code>gemini-3.8-flash</code>：原生视觉输入，适合图表、截图、PDF 转写类任务。</p></div>
            </div>
          </section>
        </section>

        <section v-else-if="activeSection === 'image-generation'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ baseOrigin }}/api/media/v1/images/generations</code>
            <UiButton size="tiny" secondary @click="copy(`${baseOrigin}/api/media/v1/images/generations`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">所有图片模型共用这一组请求与响应约定：请求体为 <code>application/json</code>，一次请求生成一张图片，响应结构与 OpenAI Images 一致。标准路径 <code>{{ apiBaseUrl }}/images/generations</code> 完全等价——只开通图片 / 视频权限的 Key 会自动落到同一渠道，同时开通文本权限时推荐显式使用 <code>/api/media/v1</code>。</p>

          <section class="article-section">
            <h2>模型与参数契约</h2>
            <p class="doc-copy">各型号的分辨率、质量档与透明背景支持并不相同，点开对应型号查看它的完整参数：</p>
            <div class="endpoint-list">
              <button v-for="doc in imageModelDocs" :key="doc.section" type="button" @click="selectSection(doc.section)">
                <span class="method-post">POST</span><code>{{ doc.modelId }}</code><span>{{ doc.summary }}</span><b>→</b>
              </button>
            </div>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>模型</th><th>分辨率</th><th>quality</th><th>透明背景</th></tr></thead><tbody>
              <tr><td><code>gpt-image-2</code></td><td>1K</td><td>auto</td><td>不支持</td></tr>
              <tr><td><code>gpt-image-2.5</code></td><td>1K</td><td>auto</td><td>不支持</td></tr>
              <tr><td><code>gpt-image-2-vip</code></td><td>1K–4K</td><td>medium</td><td>支持</td></tr>
              <tr><td><code>gpt-image-2.5-flare</code></td><td>1K–4K</td><td>low / medium / high</td><td>支持</td></tr>
              <tr><td><code>gpt-image-2.5-sunburst</code></td><td>1K–4K</td><td>low / medium / high / xhigh / max</td><td>支持</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>通用请求参数</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>参数</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead><tbody>
              <tr v-for="parameter in generationParameters" :key="parameter.name"><td><code>{{ parameter.name }}</code></td><td>{{ parameter.type }}</td><td><span :class="parameter.required ? 'required' : 'optional'">{{ parameter.required ? '是' : '否' }}</span></td><td>{{ parameter.defaultValue }}</td><td>{{ parameter.description }}</td></tr>
            </tbody></table></div>
            <p class="doc-note">型号专属约束以各型号页面为准；同时传入不支持的参数（如基础款传 <code>quality=high</code>）会直接返回 400，不会开始生成。</p>
          </section>

          <section class="article-section">
            <h2>在线调试</h2>
            <ImageApiExplorer :api-key="testerApiKey" mode="generation" provider="media" :base-url="`${baseOrigin}/api/media/v1`" @request-authorization="openAuthorization" />
          </section>

          <section class="article-section">
            <div class="section-heading"><h2>调用示例</h2><div class="language-switch"><button :class="generationLanguage === 'curl' && 'active'" @click="generationLanguage = 'curl'">cURL</button><button :class="generationLanguage === 'javascript' && 'active'" @click="generationLanguage = 'javascript'">JavaScript</button></div></div>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(generationLanguage === 'curl' ? generationCurl : generationJavaScript)">复制代码</button><pre><code>{{ generationLanguage === 'curl' ? generationCurl : generationJavaScript }}</code></pre></div>
          </section>

          <section class="article-section">
            <h2>响应示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(generationResponse)">复制 JSON</button><pre><code>{{ generationResponse }}</code></pre></div>
            <p class="doc-copy"><code>response_format=b64_json</code>（默认）时返回 Base64，平台会先下载图片并检查出站地址安全策略与大小上限：</p>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(generationResponseBase64)">复制 JSON</button><pre><code>{{ generationResponseBase64 }}</code></pre></div>
            <p class="doc-note"><code>response_format=url</code> 返回的是图片地址，上游有效期约 2 小时；需要长期保存时请立即转存到自己的对象存储或 CDN。</p>
          </section>

          <UiAlert type="warning" title="每次请求一张图">
            <code>n</code> 只支持 1，传 <code>n=2</code> 会返回 <code>400 invalid_image_request</code>；批量出图请并发提交多个请求，或使用「通用异步生成」。
          </UiAlert>
        </section>

        <section v-else-if="activeImageModel" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ baseOrigin }}{{ activeImageModel.endpoint }}</code>
            <UiButton size="tiny" secondary @click="copy(`${baseOrigin}${activeImageModel.endpoint}`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">{{ activeImageModel.summary }}</p>

          <section class="article-section">
            <h2>型号特性</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>项目</th><th>值</th></tr></thead><tbody>
              <tr v-for="trait in activeImageModel.traits" :key="trait.name"><td>{{ trait.name }}</td><td>{{ trait.value }}</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>请求参数</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>参数</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead><tbody>
              <tr v-for="parameter in activeImageModel.params" :key="parameter.name"><td><code>{{ parameter.name }}</code></td><td>{{ parameter.type }}</td><td><span :class="parameter.required ? 'required' : 'optional'">{{ parameter.required ? '是' : '否' }}</span></td><td>{{ parameter.defaultValue }}</td><td>{{ parameter.description }}</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>调用示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(activeImageModel.example)">复制代码</button><pre><code>{{ activeImageModel.example }}</code></pre></div>
          </section>

          <section class="article-section">
            <h2>计费</h2>
            <p class="doc-copy">{{ activeImageModel.pricing }}具体价格以模型广场与调用记录为准。</p>
          </section>

          <UiAlert v-if="activeImageModel.notes?.length" type="info" :title="`${activeImageModel.label} 注意事项`">
            <span v-for="note in activeImageModel.notes" :key="note" style="display: block">{{ note }}</span>
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'image-edit'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ baseOrigin }}/api/media/v1/images/edits</code>
            <UiButton size="tiny" secondary @click="copy(`${baseOrigin}/api/media/v1/images/edits`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">在原图基础上按提示词编辑。浏览器上传本地文件用 <code>multipart/form-data</code>；服务端也可以直接传图片地址或 base64 data URL。标准路径 <code>{{ apiBaseUrl }}/images/edits</code> 等价。</p>

          <UiAlert type="info">单个文件最大 20 MB，整个请求体最大 64 MB。使用 FormData 时不要手动设置 Content-Type，浏览器会自动补全 boundary。</UiAlert>

          <section class="article-section">
            <h2>请求参数</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>参数</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead><tbody>
              <tr v-for="parameter in editParameters" :key="parameter.name"><td><code>{{ parameter.name }}</code></td><td>{{ parameter.type }}</td><td><span :class="parameter.required ? 'required' : 'optional'">{{ parameter.required ? '是' : '否' }}</span></td><td>{{ parameter.defaultValue }}</td><td>{{ parameter.description }}</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>在线调试</h2>
            <ImageApiExplorer :api-key="testerApiKey" mode="edit" provider="media" :base-url="`${baseOrigin}/api/media/v1`" @request-authorization="openAuthorization" />
          </section>

          <section class="article-section">
            <div class="section-heading"><h2>调用示例</h2><div class="language-switch"><button :class="editLanguage === 'curl' && 'active'" @click="editLanguage = 'curl'">cURL</button><button :class="editLanguage === 'javascript' && 'active'" @click="editLanguage = 'javascript'">JavaScript</button></div></div>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(editLanguage === 'curl' ? editCurl : editJavaScript)">复制代码</button><pre><code>{{ editLanguage === 'curl' ? editCurl : editJavaScript }}</code></pre></div>
          </section>
        </section>

        <section v-else-if="activeSection === 'video-generation'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ baseOrigin }}/api/media/v1/videos</code>
            <UiButton size="tiny" secondary @click="copy(`${baseOrigin}/api/media/v1/videos`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">所有视频模型都走这一套异步流程：提交拿到本平台任务 id，然后轮询结果。请求参数由各模型自己定义，请先看对应型号页面。同时提供 <code>/v1/videos</code> 与 <code>/api/media/v1/api/generate</code> 两种等价入口。</p>

          <section class="article-section">
            <h2>视频模型</h2>
            <div class="endpoint-list">
              <button v-for="doc in videoModelDocs" :key="doc.section" type="button" @click="selectSection(doc.section)">
                <span class="method-post">POST</span><code>{{ doc.modelId }}</code><span>{{ doc.summary }}</span><b>→</b>
              </button>
            </div>
            <p class="doc-note">视频没有统一的参数协议：不同厂商在时长、分辨率、参考素材和取结果方式上都不一样，所以每个模型单独一页。</p>
          </section>

          <section class="article-section">
            <h2>提交流程</h2>
            <ol class="start-list">
              <li><span>01</span><div><strong>提交任务</strong><p><code>POST /api/media/v1/videos</code>，成功返回 <code>202</code> 与 <code>id</code>（形如 <code>media_...</code>）。</p></div></li>
              <li><span>02</span><div><strong>轮询结果</strong><p><code>GET /api/media/v1/videos/{id}</code>，建议每 5 秒一次，直到状态变为终态。</p></div></li>
              <li><span>03</span><div><strong>转存产物</strong><p>从 <code>results[].url</code> 下载视频，上游链接有效期约 2 小时。</p></div></li>
            </ol>
          </section>

          <section class="article-section">
            <h2>响应示例（202）</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(videoResponse)">复制 JSON</button><pre><code>{{ videoResponse }}</code></pre></div>
          </section>

          <UiAlert type="info" title="计费与并发">
            视频按各模型的计费口径在受理时冻结价格，成功后才结算；失败或违规不扣费。任务在用户、Key 和上游账户三个维度受持久化并发限制，提交前会先检查余额。
          </UiAlert>
        </section>

        <section v-else-if="activeVideoModel" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ baseOrigin }}{{ activeVideoModel.endpoint }}</code>
            <UiButton size="tiny" secondary @click="copy(`${baseOrigin}${activeVideoModel.endpoint}`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">{{ activeVideoModel.summary }}</p>

          <section class="article-section">
            <h2>型号特性</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>项目</th><th>值</th></tr></thead><tbody>
              <tr v-for="trait in activeVideoModel.traits" :key="trait.name"><td>{{ trait.name }}</td><td>{{ trait.value }}</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>请求参数</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>参数</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead><tbody>
              <tr v-for="parameter in activeVideoModel.params" :key="parameter.name"><td><code>{{ parameter.name }}</code></td><td>{{ parameter.type }}</td><td><span :class="parameter.required ? 'required' : 'optional'">{{ parameter.required ? '是' : '否' }}</span></td><td>{{ parameter.defaultValue }}</td><td>{{ parameter.description }}</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>调用示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(activeVideoModel.example)">复制代码</button><pre><code>{{ activeVideoModel.example }}</code></pre></div>
          </section>

          <section class="article-section">
            <h2>计费</h2>
            <p class="doc-copy">{{ activeVideoModel.pricing }}具体价格以模型广场与调用记录为准。</p>
          </section>

          <UiAlert v-if="activeVideoModel.notes?.length" type="info" :title="`${activeVideoModel.label} 注意事项`">
            <span v-for="note in activeVideoModel.notes" :key="note" style="display: block">{{ note }}</span>
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'video-result'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">GET</span><code>{{ baseOrigin }}/api/media/v1/videos/{id}</code>
            <UiButton size="tiny" secondary @click="copy(`${baseOrigin}/api/media/v1/videos/{id}`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">用创建任务时的同一个 API Key 查询任务。返回 <code>status</code>、<code>progress</code> 与 <code>results</code>；建议每 5 秒轮询一次，不要高频重试。</p>

          <section class="article-section">
            <h2>任务状态</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>状态</th><th>含义</th><th>处理建议</th></tr></thead><tbody>
              <tr><td><code>running</code></td><td>排队或生成中，<code>progress</code> 为 0–100。</td><td>继续轮询。</td></tr>
              <tr><td><code>succeeded</code></td><td>完成，视频地址在 <code>results[].url</code>。</td><td>下载或转存到自己存储，供应商链接可能过期。</td></tr>
              <tr><td><code>failed</code></td><td>生成失败，<code>error</code> 为脱敏后的原因。</td><td>不自动重试；确认原因后可提交新任务。</td></tr>
              <tr><td><code>violation</code></td><td>内容审核未通过。</td><td>调整提示词后重新提交。</td></tr>
            </tbody></table></div>
            <p class="doc-note">任务落库保存，服务重启后会继续查询；超过 24 小时仍未完成的任务会结束为失败。余额或 Key 配额耗尽后，仍可用原 Key 读取已创建任务的结果。</p>
          </section>

          <section class="article-section">
            <h2>查询示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(videoResultCurl)">复制代码</button><pre><code>{{ videoResultCurl }}</code></pre></div>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(videoResultResponse)">复制响应</button><pre><code>{{ videoResultResponse }}</code></pre></div>
          </section>

          <section class="article-section">
            <h2>轮询脚本</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(videoPollScript)">复制 Python</button><pre><code>{{ videoPollScript }}</code></pre></div>
          </section>
        </section>

        <section v-else-if="activeSection === 'video-async'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ baseOrigin }}/api/media/v1/api/generate</code>
            <UiButton size="tiny" secondary @click="copy(`${baseOrigin}/api/media/v1/api/generate`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">通用异步入口：图片与视频模型都可以通过它提交，统一走任务队列，适合批量出图、后端队列等场景。提交与查询都使用本平台任务 id。</p>

          <section class="article-section">
            <h2>接口</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>接口</th><th>说明</th></tr></thead><tbody>
              <tr><td><code>POST /api/media/v1/api/generate</code></td><td>提交图片或视频任务，参数与上文图片、视频接口一致（<code>aspectRatio</code>、<code>images</code>、<code>duration</code> 等）。</td></tr>
              <tr><td><code>GET /api/media/v1/api/result?id=media_xxx</code></td><td>按任务 id 查询，返回体与 <code>/videos/{id}</code> 相同。</td></tr>
              <tr><td><code>/v1/api/generate</code>、<code>/v1/api/result</code></td><td>不带前缀的等价路径。</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>调用示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(asyncGenerateCurl)">复制代码</button><pre><code>{{ asyncGenerateCurl }}</code></pre></div>
          </section>

          <UiAlert type="warning" title="提交超时不重试">
            提交阶段如果网络超时，平台不会自动重试，以避免上游已经受理时重复生成、重复扣费。请先查询任务或用列表/日志确认，再决定是否重新提交。
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'streaming'" class="article-body">
          <div class="lead-copy"><h2>一次请求同时服务文本与图片</h2><p>文本与图片接口都支持 <code>stream=true</code>，返回 <code>text/event-stream</code>。文本按各家协议推送增量（OpenAI 以 <code>data: [DONE]</code> 结束，Claude 推 <code>message_delta</code> 等事件，Gemini 用 <code>?alt=sse</code>），图片只在最后推送完成事件。</p></div>

          <section class="article-section">
            <h2>文本流式</h2>
            <p class="doc-copy">请求体加 <code>"stream": true</code> 即为 SSE，增量内容在 <code>choices[0].delta</code>（OpenAI 协议）中；用完后按用量统计结算。</p>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(chatStreamCurl)">复制代码</button><pre><code>{{ chatStreamCurl }}</code></pre></div>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(textStreamResponse)">复制事件示例</button><pre><code>{{ textStreamResponse }}</code></pre></div>
          </section>

          <section class="article-section">
            <h2>图片流式事件</h2>
            <div class="event-list">
              <div><span>生成</span><code>image_generation.completed</code></div>
              <div><span>编辑</span><code>image_edit.completed</code></div>
              <div><span>失败</span><code>error</code><small>错误事件可能在任一阶段出现</small></div>
            </div>
            <p class="doc-note">图片流式只推送最终结果，不提供中间图（<code>partial_images</code> 会返回参数错误）。</p>
          </section>

          <UiAlert type="warning">原生 EventSource 不支持 POST 和自定义 Authorization 请求头。Web 端请使用 fetch 读取 ReadableStream，或由业务后端代理流式响应。</UiAlert>

          <section class="article-section"><h2>图片流式请求</h2><div class="code-shell"><button type="button" class="copy-code" @click="copy(streamCurl)">复制代码</button><pre><code>{{ streamCurl }}</code></pre></div></section>
          <section class="article-section"><h2>图片事件示例</h2><div class="code-shell"><button type="button" class="copy-code" @click="copy(streamResponse)">复制示例</button><pre><code>{{ streamResponse }}</code></pre></div></section>
        </section>

        <section v-else-if="activeSection === 'models'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">GET</span><code>{{ apiBaseUrl }}/models</code>
            <UiButton size="tiny" secondary @click="copy(`${apiBaseUrl}/models`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">按当前 API Key 的权限返回可用模型：服务商范围、模型白名单、模型映射与账户分组都会影响结果，因此不同 Key 拿到的列表可能不同。建议客户端启动时拉取一次，而不是把模型名写死。</p>

          <section class="article-section">
            <h2>接口</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>接口</th><th>说明</th></tr></thead><tbody>
              <tr><td><code>GET /v1/models</code></td><td>OpenAI 风格列表，字段含 <code>id</code>、<code>owned_by</code>、<code>type</code>、<code>display_name</code>。</td></tr>
              <tr><td><code>GET /v1/models/{model}</code></td><td>单个模型信息，用于客户端探测。</td></tr>
              <tr><td><code>GET /v1beta/models</code></td><td>Gemini 风格列表，供 Gemini SDK 使用。</td></tr>
              <tr><td><code>GET /api/media/v1/models</code></td><td>只列出图片与视频模型，适合媒体客户端。</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>响应示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(modelsResponse)">复制 JSON</button><pre><code>{{ modelsResponse }}</code></pre></div>
            <p class="doc-note">图片与视频接口中的 <code>owned_by: modelbridge</code> 表示 Model Bridge 供给渠道；模型广场按模型厂商归类，GPT Image 归属 OpenAI，MiniMax H3 归属 MiniMax。模型名与调用方式保持不变。</p>
          </section>

          <UiAlert type="info" title="调用前需要有效额度">
            Key 所属用户余额为 0 且没有可用套餐时，连模型列表也会返回 <code>402 insufficient balance</code>；充值或开通套餐后即可正常调用。
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'integration'" class="article-body">
          <div class="lead-copy"><h2>把现有客户端指到本平台</h2><p>多数工具只需要改 Base URL 和 API Key。下表给出常见写法的对应关系；路径前缀说明见「概览」。</p></div>

          <section class="article-section">
            <h2>常见工具</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>工具 / 场景</th><th>Base URL</th><th>模型名</th><th>说明</th></tr></thead><tbody>
              <tr v-for="row in integrationRows" :key="row.tool"><td>{{ row.tool }}</td><td><code>{{ row.baseUrl }}</code></td><td>{{ row.model }}</td><td>{{ row.note }}</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <h2>计费与限制</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>项目</th><th>说明</th></tr></thead><tbody>
              <tr><td>额度</td><td>余额与订阅套餐二选一扣费，余额不足直接返回 402。</td></tr>
              <tr><td>限流</td><td>Key 可配置速率与并发上限；超限返回 429，建议指数退避。</td></tr>
              <tr><td>模型权限</td><td>Key 的服务商范围与模型白名单在转发前校验，越权返回 403。</td></tr>
              <tr><td>账户分组</td><td>分组 Key 只使用同组上游账户；未分组的 Key 只使用未分组账户。</td></tr>
              <tr><td>重试</td><td>仅网络错误、502、503 适合有限次退避重试；视频与图片提交超时不自动重试，避免重复生成与重复扣费。</td></tr>
              <tr><td>日志</td><td>所有调用都写入用量日志，可在控制台按模型、Key、时间筛选并核对费用。</td></tr>
            </tbody></table></div>
          </section>

          <UiAlert type="warning" title="跨域与反向代理">
            从浏览器直接调用时需要在反向代理中按可信来源配置 CORS，并把请求体上限放宽到至少 64 MB（图片编辑与参考图较大的视频任务）。
          </UiAlert>
        </section>

        <section v-else-if="activeSection === 'errors'" class="article-body">
          <div class="lead-copy"><h2>统一判断 HTTP 状态与错误体</h2><p>调用方应先判断 HTTP 状态，再读取错误信息。文本接口沿用各家协议的错误体（OpenAI 为 <code>error.message</code>，Anthropic 为 <code>error.type</code>），图片与视频任务接口返回扁平或嵌套的 <code>error</code> 字段。</p></div>

          <section class="article-section">
            <h2>HTTP 状态码</h2>
            <div class="table-wrap"><table class="doc-table error-table"><thead><tr><th>状态码</th><th>含义</th><th>处理建议</th></tr></thead><tbody>
              <tr><td><code>400</code></td><td>参数错误、缺少图片、内容策略拒绝</td><td>检查 error.message 后修改请求，不自动重试。</td></tr>
              <tr><td><code>401</code></td><td>API Key 缺失、无效、禁用或过期</td><td>检查 Authorization / x-api-key 与 Key 状态。</td></tr>
              <tr><td><code>402</code></td><td>余额不足（含余额为 0 时的模型列表请求）</td><td>充值或开通套餐后重试。</td></tr>
              <tr><td><code>403</code></td><td>Key 无权使用该渠道或模型、分组不允许</td><td>检查 Key 的服务商范围、模型白名单与分组。</td></tr>
              <tr><td><code>404</code></td><td>任务 id 不存在，或查询了其它 Key 创建的任务</td><td>核对任务 id 后重新查询。</td></tr>
              <tr><td><code>413</code></td><td>请求体超过大小限制</td><td>压缩输入图片或减少参考文件（单文件 20 MB、请求体 64 MB）。</td></tr>
              <tr><td><code>429</code></td><td>速率、并发或额度限制</td><td>降低并发并按退避策略重试。</td></tr>
              <tr><td><code>500</code></td><td>平台内部错误</td><td>可重试一次；持续失败请查看服务日志。</td></tr>
              <tr><td><code>502</code></td><td>上游返回错误、内容违规或没有产出（<code>502 insufficient credits</code> 表示上游账户额度不足）</td><td>先看 message 判断是否值得重试。</td></tr>
              <tr><td><code>503</code></td><td>暂无可用上游账户</td><td>短暂退避后进行有限次数重试。</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section"><h2>错误结构（图片 / 文本）</h2><div class="code-shell"><pre><code>{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_image_request",
    "message": "image generation supports n=1; submit separate requests for multiple images"
  }
}</code></pre></div></section>

          <section class="article-section"><h2>错误结构（视频 / 异步任务）</h2><div class="code-shell"><pre><code>{
  "error": "aspectRatio must be portrait or landscape"
}</code></pre></div>
            <p class="doc-note">任务处理失败时，失败原因出现在任务对象的 <code>error</code> 字段里（已脱敏），例如 <code>insufficient credits</code>。</p>
          </section>
        </section>

        <footer class="article-pagination">
          <button v-if="previousItem" type="button" @click="selectSection(previousItem.id)"><small>上一节</small><span>← {{ previousItem.label }}</span></button><span v-else />
          <button v-if="nextItem" type="button" class="next" @click="selectSection(nextItem.id)"><small>下一节</small><span>{{ nextItem.label }} →</span></button>
        </footer>
      </article>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.docs-page {
  @apply min-h-dvh bg-gray-50 text-gray-900 dark:bg-dark-950 dark:text-dark-100;
}

.docs-skip-link {
  @apply fixed left-4 top-3 z-50 -translate-y-20 rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-primary-400 dark:bg-white dark:text-dark-950;
}

.docs-topbar {
  @apply sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur-xl dark:border-dark-800 dark:bg-dark-900/90;
}

.docs-topbar-inner {
  @apply mx-auto flex min-h-[4.25rem] max-w-[1536px] items-center justify-between gap-5 px-4 sm:px-6 lg:px-8;
}

.docs-brand {
  @apply flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30;
}

.docs-brand strong { @apply truncate text-sm font-extrabold tracking-tight text-gray-950 dark:text-white; }
.docs-brand > span:last-child { @apply hidden border-l border-gray-200 pl-2.5 text-xs font-semibold text-gray-400 dark:border-dark-700 dark:text-dark-400 sm:block; }

.docs-top-actions { @apply flex items-center gap-1; }
.docs-top-actions a { @apply hidden rounded-lg px-3 py-2 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:text-dark-400 dark:hover:bg-dark-800 dark:hover:text-white sm:block; }
.docs-top-actions .docs-console-link { @apply block border border-gray-200 bg-white text-gray-800 shadow-sm hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-100 dark:hover:border-primary-700 dark:hover:bg-primary-900/20 dark:hover:text-primary-300; }

.docs-page-content {
  @apply px-4 pb-10 pt-6 sm:px-6 lg:px-8;
}

.docs-layout {
  @apply mx-auto grid max-w-[1440px] gap-6;
  transition: grid-template-columns 240ms ease;
}

.docs-layout-expanded { @apply xl:grid-cols-[15rem_minmax(0,1fr)]; }
.docs-layout-collapsed { @apply xl:grid-cols-[3.75rem_minmax(0,1fr)]; }

.docs-sidebar {
  @apply relative hidden xl:block;
}

.docs-sidebar-inner {
  @apply sticky top-[5.75rem] flex max-h-[calc(100dvh-7.25rem)] flex-col border-r border-gray-200 pr-5 dark:border-dark-700;
}

.docs-sidebar-toolbar {
  @apply mb-5 flex items-center gap-2;
}

.docs-collapse-button {
  @apply flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 shadow-sm transition hover:border-primary-300 hover:text-primary-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-400 dark:hover:border-primary-700 dark:hover:text-primary-300;
}
.docs-collapse-button svg { @apply h-3.5 w-3.5 transition-transform; }

.docs-search {
  @apply flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 transition focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/10 dark:border-dark-700 dark:bg-dark-900;
}
.docs-search svg { @apply h-4 w-4 flex-shrink-0 text-gray-400; }
.docs-search input { @apply min-w-0 flex-1 bg-transparent text-xs text-gray-800 outline-none placeholder:text-gray-400 dark:text-dark-100; }

.docs-nav { @apply min-h-0 flex-1 space-y-6 overflow-y-auto pb-5; }
.docs-nav-group > p { @apply mb-2 px-2 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400 dark:text-dark-500; }
.docs-nav-item { @apply mb-1 block w-full rounded-lg border-l-2 border-transparent px-2.5 py-2 text-left transition duration-200 hover:bg-gray-100/80 active:translate-y-px dark:hover:bg-dark-800; }
.docs-nav-item:focus-visible { @apply outline-none ring-2 ring-primary-500/30; }
.docs-nav-item-active { @apply border-primary-500 bg-primary-50/80 dark:bg-primary-900/15; }
.docs-nav-label { @apply flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 dark:text-dark-200; }
.docs-nav-item-active .docs-nav-label { @apply text-primary-700 dark:text-primary-300; }
.docs-nav-item small { @apply mt-0.5 block truncate text-[10px] text-gray-400 dark:text-dark-500; }
.docs-nav-copy { @apply block min-w-0; }
.docs-nav-symbol { @apply hidden h-8 w-8 items-center justify-center rounded-lg text-gray-500 dark:text-dark-400; }
.docs-nav-symbol svg { @apply h-[1.125rem] w-[1.125rem]; }
.nav-method { @apply ml-auto font-mono text-[8px] font-black tracking-wide text-emerald-600 dark:text-emerald-400; }
.docs-empty { @apply px-2 py-8 text-center text-xs text-gray-400; }

.docs-base-url { @apply border-t border-gray-200 pt-4 dark:border-dark-700; }
.docs-base-url > span { @apply mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400; }
.docs-base-url button { @apply flex w-full items-center gap-2 rounded-lg bg-gray-100 px-2.5 py-2 text-left transition hover:bg-gray-200 dark:bg-dark-800 dark:hover:bg-dark-700; }
.docs-base-url code { @apply min-w-0 flex-1 truncate text-[10px] font-semibold text-gray-600 dark:text-dark-300; }
.docs-base-url svg { @apply h-3.5 w-3.5 flex-shrink-0 text-gray-400; }

.docs-layout-collapsed .docs-sidebar-inner { @apply pr-3; }
.docs-layout-collapsed .docs-sidebar-toolbar { @apply justify-center; }
.docs-layout-collapsed .docs-search,
.docs-layout-collapsed .docs-nav-group > p,
.docs-layout-collapsed .docs-nav-copy,
.docs-layout-collapsed .docs-base-url > span,
.docs-layout-collapsed .docs-base-url code { @apply hidden; }
.docs-layout-collapsed .docs-nav { @apply space-y-2 overflow-visible; }
.docs-layout-collapsed .docs-nav-group { @apply space-y-1; }
.docs-layout-collapsed .docs-nav-item { @apply flex items-center justify-center border-l-0 px-1 py-1.5; }
.docs-layout-collapsed .docs-nav-symbol { @apply flex; }
.docs-layout-collapsed .docs-nav-item-active { @apply bg-primary-50 ring-1 ring-inset ring-primary-200 dark:bg-primary-900/20 dark:ring-primary-800; }
.docs-layout-collapsed .docs-nav-item-active .docs-nav-symbol { @apply text-primary-700 dark:text-primary-300; }
.docs-layout-collapsed .docs-base-url button { @apply justify-center px-2; }

.docs-main { @apply min-w-0; }
.docs-mobile-nav { @apply mb-4 block rounded-xl border border-gray-200 bg-white p-3 dark:border-dark-700 dark:bg-dark-900 xl:hidden; }
.docs-mobile-nav span { @apply mb-1.5 block text-xs font-semibold text-gray-500 dark:text-dark-400; }
.docs-mobile-nav select { @apply w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:border-primary-400 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-100; }

.docs-article { @apply min-w-0 rounded-2xl border border-gray-200 bg-white px-5 pb-6 pt-7 shadow-[0_12px_36px_rgba(15,23,42,0.04)] dark:border-dark-700 dark:bg-dark-900 sm:px-8 lg:px-10; scroll-margin-top: 1rem; }
.article-header { @apply border-b border-gray-200 pb-6 dark:border-dark-700; }
.article-kicker { @apply mb-3 text-[11px] font-bold tracking-wide text-primary-600 dark:text-primary-300; }
.article-kicker span { @apply mx-1 text-gray-300 dark:text-dark-600; }
.article-title-row { @apply flex items-start justify-between gap-5; }
.article-title-row h1 { @apply text-3xl font-black leading-tight tracking-[-0.035em] text-gray-950 dark:text-white sm:text-4xl; text-wrap: balance; }
.article-title-row p { @apply mt-2 text-sm leading-6 text-gray-500 dark:text-dark-400; }

.article-body { @apply grid gap-7 py-7; }
.lead-copy { @apply max-w-3xl; }
.lead-copy h2 { @apply text-xl font-extrabold tracking-tight text-gray-950 dark:text-white; }
.lead-copy p { @apply mt-2 max-w-[68ch] text-[15px] leading-7 text-gray-600 dark:text-dark-300; text-wrap: pretty; }
.article-section { @apply grid gap-3 border-t border-gray-100 pt-6 dark:border-dark-800; }
.article-section > h2, .section-heading h2 { @apply text-base font-extrabold tracking-tight text-gray-950 dark:text-white; }
.section-heading { @apply flex flex-wrap items-center justify-between gap-3; }

.status-line { @apply flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-dark-800/70 dark:text-dark-400; }
.status-line strong { @apply text-gray-800 dark:text-dark-100; }
.status-line code { @apply ml-auto font-semibold text-gray-600 dark:text-dark-300; }
.status-dot { @apply h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]; }

.start-list { @apply divide-y divide-gray-100 border-y border-gray-100 dark:divide-dark-800 dark:border-dark-800; }
.start-list li { @apply grid grid-cols-[2.5rem_1fr] gap-4 py-5; }
.start-list li > span { @apply font-mono text-xs font-bold text-primary-500; }
.start-list strong { @apply text-sm font-bold text-gray-900 dark:text-white; }
.start-list p { @apply mt-1 max-w-[68ch] text-[13px] leading-6 text-gray-500 dark:text-dark-400; }
.start-list code { @apply font-semibold text-gray-700 dark:text-dark-200; }

.endpoint-list { @apply overflow-hidden rounded-xl border border-gray-200 dark:border-dark-700; }
.endpoint-list button { @apply grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-gray-100 px-4 py-4 text-left transition hover:bg-gray-50 active:translate-y-px last:border-b-0 dark:border-dark-800 dark:hover:bg-dark-800/60 sm:grid-cols-[auto_minmax(12rem,1fr)_minmax(10rem,1fr)_auto]; }
.endpoint-list code { @apply truncate text-xs font-semibold text-gray-800 dark:text-dark-100; }
.endpoint-list button > span:nth-child(3) { @apply hidden text-xs text-gray-500 dark:text-dark-400 sm:block; }
.endpoint-list b { @apply text-gray-300 transition-transform group-hover:translate-x-1 dark:text-dark-600; }

.method-post { @apply rounded-md bg-emerald-100 px-2 py-1 font-mono text-[9px] font-black tracking-wide text-emerald-700 dark:bg-emerald-900/35 dark:text-emerald-300; }
.endpoint-bar { @apply flex min-w-0 items-center gap-3 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm dark:border-dark-700 dark:bg-dark-800/70; }
.endpoint-bar > code { @apply min-w-0 flex-1 whitespace-nowrap font-semibold text-gray-800 dark:text-dark-100; }
.doc-copy { @apply max-w-[68ch] text-sm leading-6 text-gray-600 dark:text-dark-300; }
.doc-copy code, .doc-note code { @apply font-semibold text-gray-800 dark:text-dark-100; }
.doc-note { @apply text-xs leading-5 text-gray-500 dark:text-dark-400; }

.table-wrap { @apply overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-700; }
.doc-table { @apply w-full min-w-[760px] border-collapse text-left text-[13px]; }
.doc-table th { @apply whitespace-nowrap border-b border-gray-200 bg-gray-50 px-4 py-3 font-bold text-gray-600 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-300; }
.doc-table td { @apply border-b border-gray-100 px-4 py-3 align-top leading-5 text-gray-600 dark:border-dark-800 dark:text-dark-300; }
.doc-table tr:last-child td { @apply border-b-0; }
.doc-table td code { @apply whitespace-nowrap font-semibold text-primary-600 dark:text-primary-300; }
.required { @apply font-semibold text-red-600 dark:text-red-400; }
.optional { @apply text-gray-400 dark:text-dark-500; }

.language-switch { @apply inline-flex rounded-lg bg-gray-100 p-1 dark:bg-dark-800; }
.language-switch button { @apply rounded-md px-3 py-1.5 text-xs font-semibold text-gray-500 transition hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:text-dark-400 dark:hover:text-white; }
.language-switch button.active { @apply bg-white text-gray-900 shadow-sm dark:bg-dark-700 dark:text-white; }

.code-shell { @apply relative overflow-hidden rounded-lg border border-slate-700 bg-slate-950; }
.code-shell pre { @apply overflow-x-auto p-4 pr-20 text-[13px] leading-6 text-slate-200; }
.code-shell code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.copy-code { @apply absolute right-2 top-2 z-10 rounded-md border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400; }

.security-list { @apply divide-y divide-gray-100 border-y border-gray-100 dark:divide-dark-800 dark:border-dark-800; }
.security-list div { @apply grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-5; }
.security-list strong { @apply text-sm font-bold text-gray-800 dark:text-dark-100; }
.security-list p { @apply text-[13px] leading-6 text-gray-500 dark:text-dark-400; }

.event-list { @apply overflow-hidden rounded-lg border border-gray-200 dark:border-dark-700; }
.event-list > div { @apply grid gap-2 border-b border-gray-100 px-4 py-4 last:border-0 dark:border-dark-800 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)]; }
.event-list span { @apply text-xs font-bold text-gray-500 dark:text-dark-400; }
.event-list code { @apply break-all text-xs font-semibold text-gray-800 dark:text-dark-100; }
.event-list small { @apply text-xs text-gray-400; }

.article-pagination { @apply mt-2 grid grid-cols-2 gap-4 border-t border-gray-200 pt-6 dark:border-dark-700; }
.article-pagination button { @apply rounded-lg border border-gray-200 px-4 py-3 text-left transition hover:border-primary-300 hover:bg-primary-50/50 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:border-dark-700 dark:hover:border-primary-700 dark:hover:bg-primary-900/10; }
.article-pagination button.next { @apply text-right; }
.article-pagination small { @apply block text-[10px] font-medium text-gray-400; }
.article-pagination span { @apply mt-1 block text-xs font-bold text-gray-700 dark:text-dark-200; }

@media (max-width: 639px) {
  .docs-article { @apply rounded-xl px-4 pt-5; }
  .article-title-row h1 { @apply text-2xl; }
  .status-line code { @apply ml-0 w-full; }
  .endpoint-bar :deep(.btn) { @apply hidden; }
}
</style>
