<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useCollapsibleSidebar } from '../composables/useCollapsibleSidebar'
import { useMessage } from '../composables/useMessage'

type DocSection = 'overview' | 'authentication' | 'image-generation' | 'image-edit' | 'streaming' | 'errors'
type DocIcon = DocSection

interface ParameterRow {
  name: string
  type: string
  required: boolean
  defaultValue: string
  description: string
}

interface NavigationItem {
  id: DocSection
  label: string
  icon: DocIcon
  description: string
  method?: 'POST'
}

interface NavigationGroup {
  label: string
  items: NavigationItem[]
}

const message = useMessage()
const activeSection = ref<DocSection>('overview')
const docsSearch = ref('')
const generationLanguage = ref<'curl' | 'javascript'>('curl')
const editLanguage = ref<'curl' | 'javascript'>('curl')
const { collapsed: docsSidebarCollapsed, toggle: toggleDocsSidebarCollapsed } = useCollapsibleSidebar('mb_api_docs_sidebar_collapsed')
let previousDocumentTitle = ''

const baseOrigin = computed(() => {
  if (typeof window === 'undefined') return 'http://localhost:3000'
  return window.location.origin
})
const apiBaseUrl = computed(() => `${baseOrigin.value}/v1`)

const docsIconPaths: Record<DocIcon, string[]> = {
  overview: [
    'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 8.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  ],
  authentication: [
    'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.03 5.91c-.56-.1-1.16.03-1.56.43l-2.66 2.66H8.25v2.25H6v2.25H2.25v-2.82c0-.6.24-1.17.66-1.59l6.5-6.5A6 6 0 1121.75 8.25z',
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
      { id: 'overview', label: '概览', icon: 'overview', description: '能力、入口与快速开始' },
      { id: 'authentication', label: '认证', icon: 'authentication', description: 'API Key 与安全建议' },
    ],
  },
  {
    label: '图片 API',
    items: [
      { id: 'image-generation', label: '生成图片', icon: 'image-generation', description: '/images/generations', method: 'POST' },
      { id: 'image-edit', label: '编辑图片', icon: 'image-edit', description: '/images/edits', method: 'POST' },
      { id: 'streaming', label: '流式响应', icon: 'streaming', description: 'SSE 事件与前端读取' },
    ],
  },
  {
    label: '通用说明',
    items: [{ id: 'errors', label: '错误处理', icon: 'errors', description: '状态码与错误结构' }],
  },
]

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
  "data": [{ "url": "data:image/png;base64,iVBORw0KGgoAAA..." }],
  "output_format": "png",
  "quality": "high",
  "size": "1024x1024",
  "model": "gpt-image-2",
  "usage": { "input_tokens": 123, "output_tokens": 456 }
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

function isDocSection(value: string): value is DocSection {
  return navigationItems.some((item) => item.id === value)
}

function syncSectionFromHash(): void {
  const section = window.location.hash.slice(1)
  if (isDocSection(section)) activeSection.value = section
}

function selectSection(section: DocSection): void {
  activeSection.value = section
  docsSearch.value = ''
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${section}`)
  document.querySelector('.docs-article')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleMobileSection(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (isDocSection(value)) selectSection(value)
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
          <span class="docs-brand-mark"><span /></span>
          <strong>Model Bridge</strong>
          <span>API 文档</span>
        </RouterLink>
        <nav class="docs-top-actions" aria-label="页面导航">
          <RouterLink to="/">首页</RouterLink>
          <RouterLink to="/app">用户控制台</RouterLink>
          <RouterLink to="/overview" class="docs-console-link">管理控制台</RouterLink>
        </nav>
      </div>
    </header>

    <div class="docs-page-content">
      <div class="docs-layout" :class="docsSidebarCollapsed ? 'docs-layout-collapsed' : 'docs-layout-expanded'">
        <aside class="docs-sidebar" aria-label="API 文档目录">
      <div class="docs-sidebar-inner">
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
        <div class="docs-product">
          <span class="docs-mark">MB</span>
          <div class="docs-product-copy">
            <strong>API Reference</strong>
            <span>Model Bridge · v1</span>
          </div>
        </div>

        <label class="docs-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35m2.1-5.4a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
          </svg>
          <input v-model="docsSearch" type="search" placeholder="搜索文档" />
        </label>

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
                <span v-if="item.method" class="nav-method">{{ item.method }}</span>
                {{ item.label }}
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
            <UiTag v-if="activeNavigationItem.method" type="success">{{ activeNavigationItem.method }}</UiTag>
          </div>
        </header>

        <section v-if="activeSection === 'overview'" class="article-body">
          <div class="lead-copy">
            <h2>使用统一接口调用图片能力</h2>
            <p>Model Bridge 提供兼容 OpenAI Images 的 HTTP API，覆盖文生图、图片编辑和 SSE 流式结果。所有请求复用平台现有的账号调度、API Key 权限、额度和用量统计。</p>
          </div>

          <div class="status-line">
            <span class="status-dot" />
            <strong>接口已内置</strong>
            <span>JSON · multipart · SSE</span>
            <code>gpt-image-2</code>
          </div>

          <section class="article-section">
            <h2>快速开始</h2>
            <ol class="start-list">
              <li><span>01</span><div><strong>创建平台 API Key</strong><p>在控制台的 API Keys 页面创建一个以 <code>mb-</code> 开头的密钥，并允许访问 OpenAI 图片模型。</p></div></li>
              <li><span>02</span><div><strong>设置请求地址与鉴权</strong><p>将 Base URL 设为 <code>{{ apiBaseUrl }}</code>，通过 Bearer Token 传递 API Key。</p></div></li>
              <li><span>03</span><div><strong>发送第一条生图请求</strong><p>调用 <code>POST /images/generations</code>，至少传入非空的 <code>prompt</code>。</p></div></li>
            </ol>
          </section>

          <section class="article-section">
            <h2>可用接口</h2>
            <div class="endpoint-list">
              <button type="button" @click="selectSection('image-generation')">
                <span class="method-post">POST</span><code>/v1/images/generations</code><span>根据提示词生成图片</span><b>→</b>
              </button>
              <button type="button" @click="selectSection('image-edit')">
                <span class="method-post">POST</span><code>/v1/images/edits</code><span>上传并编辑图片</span><b>→</b>
              </button>
            </div>
          </section>

          <UiAlert type="info" title="返回格式">
            <code>response_format=b64_json</code> 返回纯 Base64；<code>response_format=url</code> 返回可直接赋给 <code>&lt;img src&gt;</code> 的 Data URL，不是长期公网地址。
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

        <section v-else-if="activeSection === 'image-generation'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ apiBaseUrl }}/images/generations</code>
            <UiButton size="tiny" secondary @click="copy(`${apiBaseUrl}/images/generations`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">根据文本提示词生成一张或多张图片。请求体使用 <code>application/json</code>。</p>

          <section class="article-section">
            <h2>请求参数</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>参数</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead><tbody>
              <tr v-for="parameter in generationParameters" :key="parameter.name"><td><code>{{ parameter.name }}</code></td><td>{{ parameter.type }}</td><td><span :class="parameter.required ? 'required' : 'optional'">{{ parameter.required ? '是' : '否' }}</span></td><td>{{ parameter.defaultValue }}</td><td>{{ parameter.description }}</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <div class="section-heading"><h2>调用示例</h2><div class="language-switch"><button :class="generationLanguage === 'curl' && 'active'" @click="generationLanguage = 'curl'">cURL</button><button :class="generationLanguage === 'javascript' && 'active'" @click="generationLanguage = 'javascript'">JavaScript</button></div></div>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(generationLanguage === 'curl' ? generationCurl : generationJavaScript)">复制代码</button><pre><code>{{ generationLanguage === 'curl' ? generationCurl : generationJavaScript }}</code></pre></div>
          </section>

          <section class="article-section">
            <h2>响应示例</h2>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(generationResponse)">复制 JSON</button><pre><code>{{ generationResponse }}</code></pre></div>
            <p class="doc-note"><code>response_format=url</code> 返回 Data URL。需要长期访问时，请将图片上传到自己的对象存储或 CDN。</p>
          </section>
        </section>

        <section v-else-if="activeSection === 'image-edit'" class="article-body">
          <div class="endpoint-bar">
            <span class="method-post">POST</span><code>{{ apiBaseUrl }}/images/edits</code>
            <UiButton size="tiny" secondary @click="copy(`${apiBaseUrl}/images/edits`)">复制地址</UiButton>
          </div>
          <p class="doc-copy">上传原图并通过提示词进行编辑。浏览器上传本地文件时推荐使用 <code>multipart/form-data</code>。</p>

          <UiAlert type="info">每个 multipart 文件最大 20 MB，整个请求体最大 64 MB。使用 FormData 时不要手动设置 Content-Type，浏览器会自动补全 boundary。</UiAlert>

          <section class="article-section">
            <h2>请求参数</h2>
            <div class="table-wrap"><table class="doc-table"><thead><tr><th>参数</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead><tbody>
              <tr v-for="parameter in editParameters" :key="parameter.name"><td><code>{{ parameter.name }}</code></td><td>{{ parameter.type }}</td><td><span :class="parameter.required ? 'required' : 'optional'">{{ parameter.required ? '是' : '否' }}</span></td><td>{{ parameter.defaultValue }}</td><td>{{ parameter.description }}</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section">
            <div class="section-heading"><h2>调用示例</h2><div class="language-switch"><button :class="editLanguage === 'curl' && 'active'" @click="editLanguage = 'curl'">cURL</button><button :class="editLanguage === 'javascript' && 'active'" @click="editLanguage = 'javascript'">JavaScript</button></div></div>
            <div class="code-shell"><button type="button" class="copy-code" @click="copy(editLanguage === 'curl' ? editCurl : editJavaScript)">复制代码</button><pre><code>{{ editLanguage === 'curl' ? editCurl : editJavaScript }}</code></pre></div>
          </section>
        </section>

        <section v-else-if="activeSection === 'streaming'" class="article-body">
          <div class="lead-copy"><h2>通过 SSE 接收中间图和最终结果</h2><p>请求中设置 <code>stream=true</code> 后，接口返回 <code>text/event-stream</code>。设置 <code>partial_images</code> 可以请求最多 3 张中间图。</p></div>

          <section class="article-section">
            <h2>事件类型</h2>
            <div class="event-list">
              <div><span>生成</span><code>image_generation.partial_image</code><code>image_generation.completed</code></div>
              <div><span>编辑</span><code>image_edit.partial_image</code><code>image_edit.completed</code></div>
              <div><span>失败</span><code>error</code><small>错误事件可能在任一阶段出现</small></div>
            </div>
          </section>

          <UiAlert type="warning">原生 EventSource 不支持 POST 和自定义 Authorization 请求头。Web 端请使用 fetch 读取 ReadableStream，或由业务后端代理流式响应。</UiAlert>

          <section class="article-section"><h2>流式请求</h2><div class="code-shell"><button type="button" class="copy-code" @click="copy(streamCurl)">复制代码</button><pre><code>{{ streamCurl }}</code></pre></div></section>
          <section class="article-section"><h2>事件示例</h2><div class="code-shell"><button type="button" class="copy-code" @click="copy(streamResponse)">复制示例</button><pre><code>{{ streamResponse }}</code></pre></div></section>
        </section>

        <section v-else class="article-body">
          <div class="lead-copy"><h2>统一判断 HTTP 状态与错误体</h2><p>调用方应先判断 HTTP 状态，再读取 <code>error.message</code> 和 <code>error.code</code>。只有网络错误、502 和 503 适合进行有限次数的退避重试。</p></div>

          <section class="article-section">
            <h2>HTTP 状态码</h2>
            <div class="table-wrap"><table class="doc-table error-table"><thead><tr><th>状态码</th><th>含义</th><th>处理建议</th></tr></thead><tbody>
              <tr><td><code>400</code></td><td>参数错误、缺少图片或内容策略拒绝</td><td>检查 error.message 后修改请求，不自动重试。</td></tr>
              <tr><td><code>401</code></td><td>API Key 缺失、无效、禁用或过期</td><td>检查 Authorization 请求头和 Key 状态。</td></tr>
              <tr><td><code>402</code></td><td>账户余额不足</td><td>充值后重试。</td></tr>
              <tr><td><code>403</code></td><td>生图功能关闭，或 Key 无权使用模型</td><td>检查功能开关和 Key 访问范围。</td></tr>
              <tr><td><code>413</code></td><td>请求体超过大小限制</td><td>压缩输入图片或减少上传文件。</td></tr>
              <tr><td><code>429</code></td><td>速率、并发或额度限制</td><td>降低并发并按退避策略重试。</td></tr>
              <tr><td><code>502 / 503</code></td><td>上游无图片输出或暂无可用账号</td><td>短暂退避后进行有限次数重试。</td></tr>
            </tbody></table></div>
          </section>

          <section class="article-section"><h2>错误结构</h2><div class="code-shell"><pre><code>{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_image_request",
    "message": "prompt is required"
  }
}</code></pre></div></section>
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

.docs-brand-mark {
  @apply flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500 shadow-sm shadow-primary-500/20;
}
.docs-brand-mark > span { @apply h-3 w-3 rotate-45 rounded-[3px] bg-white; }
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

.docs-collapse-button {
  @apply absolute -right-3 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 shadow-sm transition hover:border-primary-300 hover:text-primary-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 dark:border-dark-700 dark:bg-dark-800 dark:text-dark-400 dark:hover:border-primary-700 dark:hover:text-primary-300;
}
.docs-collapse-button svg { @apply h-3.5 w-3.5 transition-transform; }

.docs-product {
  @apply mb-5 flex items-center gap-3 px-1;
}

.docs-mark {
  @apply flex h-9 w-9 items-center justify-center rounded-lg bg-gray-950 text-[11px] font-black tracking-wider text-white dark:bg-white dark:text-dark-950;
}

.docs-product strong { @apply block text-sm font-extrabold tracking-tight text-gray-950 dark:text-white; }
.docs-product div > span { @apply mt-0.5 block text-[11px] font-medium text-gray-400 dark:text-dark-400; }
.docs-product-copy { @apply min-w-0; }

.docs-search {
  @apply mb-5 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 transition focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/10 dark:border-dark-700 dark:bg-dark-900;
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
.nav-method { @apply font-mono text-[8px] font-black tracking-wide text-emerald-600 dark:text-emerald-400; }
.docs-empty { @apply px-2 py-8 text-center text-xs text-gray-400; }

.docs-base-url { @apply border-t border-gray-200 pt-4 dark:border-dark-700; }
.docs-base-url > span { @apply mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400; }
.docs-base-url button { @apply flex w-full items-center gap-2 rounded-lg bg-gray-100 px-2.5 py-2 text-left transition hover:bg-gray-200 dark:bg-dark-800 dark:hover:bg-dark-700; }
.docs-base-url code { @apply min-w-0 flex-1 truncate text-[10px] font-semibold text-gray-600 dark:text-dark-300; }
.docs-base-url svg { @apply h-3.5 w-3.5 flex-shrink-0 text-gray-400; }

.docs-layout-collapsed .docs-sidebar-inner { @apply pr-3; }
.docs-layout-collapsed .docs-product { @apply justify-center px-0; }
.docs-layout-collapsed .docs-product-copy,
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
