/**
 * Static model catalog for the Model Plaza (模型广场).
 *
 * Frontend-only display data — it does NOT drive relaying. Model ids, tiers
 * and prices mirror src/providers/modelDiscovery.ts and src/usage/pricing.ts
 * so the plaza stays consistent with what the relay actually exposes and
 * bills. When a backend `/models` catalog endpoint lands, swap `MODEL_CATALOG`
 * for a fetch that returns the same `PlazaModel` shape.
 */

export type ProviderId = 'claude' | 'openai' | 'gemini' | 'deepseek' | 'xiaomi' | 'zhipu' | 'qwen' | 'kimi'

export interface ProviderMeta {
  id: ProviderId
  /** Short label shown on cards (the upstream vendor brand). */
  label: string
  /** 1–2 letter mark for the logo chip. */
  initials: string
  /** Tailwind classes for the logo chip background/text. */
  chipClass: string
}

export interface CategoryMeta {
  key: string
  label: string
}

export interface PlazaModel {
  /** Model id used when calling the relay (body.model). */
  id: string
  /** Human-friendly display name. */
  name: string
  provider: ProviderId
  /** Category keys this model belongs to (see CATEGORIES). */
  categories: string[]
  /** Capability chips shown on the card. */
  tags: string[]
  description: string
  /** Context window, display string (e.g. "200K"). */
  context: string
  /** USD list price per 1M tokens. */
  inputPrice: number
  outputPrice: number
  /** Optional highlight badge. */
  badge?: 'new' | 'recommended'
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: 'claude',
    label: 'Anthropic',
    initials: 'A',
    chipClass: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    initials: 'AI',
    chipClass: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  gemini: {
    id: 'gemini',
    label: 'Google',
    initials: 'G',
    chipClass: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    initials: 'DS',
    chipClass: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
  xiaomi: {
    id: 'xiaomi',
    label: '小米 MiMo',
    initials: 'Mi',
    chipClass: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  },
  zhipu: {
    id: 'zhipu',
    label: '智谱 GLM',
    initials: '智',
    chipClass: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  },
  qwen: {
    id: 'qwen',
    label: '通义 Qwen',
    initials: '通',
    chipClass: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300',
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi 月之暗面',
    initials: 'K',
    chipClass: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200',
  },
}

/** Capability categories used by the top filter. "all" is rendered separately. */
export const CATEGORIES: CategoryMeta[] = [
  { key: 'chat', label: '对话生成' },
  { key: 'reasoning', label: '深度推理' },
  { key: 'code', label: '代码开发' },
  { key: 'multimodal', label: '多模态' },
  { key: 'lightweight', label: '轻量高速' },
]

export const MODEL_CATALOG: PlazaModel[] = [
  // --- Anthropic / Claude --------------------------------------------------
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    provider: 'claude',
    categories: ['chat', 'reasoning', 'code'],
    tags: ['旗舰', '复杂推理', 'Agent'],
    description: 'Anthropic 最新旗舰模型，擅长复杂 Agent 编码与企业级任务，长上下文理解与推理能力出色。',
    context: '1M',
    inputPrice: 5,
    outputPrice: 25,
    badge: 'recommended',
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'claude',
    categories: ['chat', 'reasoning', 'code'],
    tags: ['稳定', '复杂推理', '长文本'],
    description: 'Anthropic 上一代旗舰模型，擅长复杂推理、长上下文理解与高质量代码生成。',
    context: '1M',
    inputPrice: 5,
    outputPrice: 25,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'claude',
    categories: ['chat', 'code', 'reasoning'],
    tags: ['均衡', '高性价比', '代码'],
    description: '性能与成本平衡的主力模型，编码与 Agent 表现接近 Opus，日常对话与中等推理的首选。',
    context: '1M',
    inputPrice: 3,
    outputPrice: 15,
    badge: 'new',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'claude',
    categories: ['chat', 'lightweight'],
    tags: ['轻量', '低延迟', '低成本'],
    description: '轻量高速模型，适合高并发、低延迟与成本敏感的对话场景。',
    context: '200K',
    inputPrice: 1,
    outputPrice: 5,
  },
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    provider: 'claude',
    categories: ['chat', 'reasoning'],
    tags: ['Mythos 级', '创意写作'],
    description: 'Anthropic 最强模型，长文创作、叙事推理与超长程 Agent 能力突出。',
    context: '1M',
    inputPrice: 10,
    outputPrice: 50,
    badge: 'new',
  },

  // --- OpenAI --------------------------------------------------------------
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    provider: 'openai',
    categories: ['chat', 'reasoning', 'multimodal'],
    tags: ['旗舰', '推理', 'Agent'],
    description: 'GPT-5.6 家族旗舰，最强推理与 Agent 编码能力，定价对齐上一代 GPT-5.5。',
    context: '256K',
    inputPrice: 5,
    outputPrice: 30,
    badge: 'recommended',
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    provider: 'openai',
    categories: ['chat', 'reasoning'],
    tags: ['主力', '性价比'],
    description: '日常主力模型，性能对标上一代旗舰而价格减半，适合大多数生产负载。',
    context: '256K',
    inputPrice: 2.5,
    outputPrice: 15,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    provider: 'openai',
    categories: ['chat', 'lightweight'],
    tags: ['低价', '高速', '高并发'],
    description: '最快最省的 GPT-5.6 档，面向分类、抽取、路由与初稿等高并发场景。',
    context: '256K',
    inputPrice: 1,
    outputPrice: 6,
    badge: 'new',
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'openai',
    categories: ['chat', 'reasoning', 'multimodal'],
    tags: ['多模态', '推理'],
    description: 'OpenAI 上一代旗舰多模态模型，综合推理、文本与图像理解能力领先。',
    context: '256K',
    inputPrice: 5,
    outputPrice: 30,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    categories: ['chat', 'reasoning'],
    tags: ['通用', '稳定'],
    description: '通用主力模型，覆盖大多数对话与推理任务，稳定可靠。',
    context: '256K',
    inputPrice: 2.5,
    outputPrice: 15,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    categories: ['chat', 'lightweight'],
    tags: ['轻量', '低成本', '高速'],
    description: '小尺寸高速模型，适合大批量、低成本的对话与分类任务。',
    context: '128K',
    inputPrice: 0.25,
    outputPrice: 2,
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    provider: 'openai',
    categories: ['code', 'reasoning'],
    tags: ['代码', 'Agent', 'Codex CLI'],
    description: '面向编程与 Agent 的专用模型，深度适配 Codex CLI 工作流。',
    context: '256K',
    inputPrice: 1.5,
    outputPrice: 12,
  },

  // --- Google / Gemini -----------------------------------------------------
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    provider: 'gemini',
    categories: ['chat', 'reasoning', 'multimodal'],
    tags: ['超长上下文', '多模态', '预览'],
    description: 'Google 新一代旗舰，超长上下文与原生多模态理解能力突出。',
    context: '1M',
    inputPrice: 1.25,
    outputPrice: 10,
    badge: 'new',
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    provider: 'gemini',
    categories: ['chat', 'lightweight', 'multimodal'],
    tags: ['高速', '低成本', '多模态'],
    description: '高速低成本的多模态模型，兼顾长上下文与吞吐表现。',
    context: '1M',
    inputPrice: 0.3,
    outputPrice: 2.5,
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    categories: ['chat', 'reasoning', 'multimodal'],
    tags: ['长上下文', '多模态'],
    description: '成熟稳定的多模态推理模型，长上下文场景表现优秀。',
    context: '1M',
    inputPrice: 1.25,
    outputPrice: 10,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    categories: ['chat', 'lightweight', 'multimodal'],
    tags: ['高速', '低成本'],
    description: '轻量高速多模态模型，适合实时与高并发场景。',
    context: '1M',
    inputPrice: 0.3,
    outputPrice: 2.5,
  },

  // --- DeepSeek ------------------------------------------------------------
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    categories: ['chat', 'reasoning', 'code'],
    tags: ['强推理', '高性价比', '代码'],
    description: '强推理主力模型，代码与数理能力突出，价格极具竞争力。',
    context: '1M',
    inputPrice: 0.435,
    outputPrice: 0.87,
    badge: 'recommended',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    categories: ['chat', 'lightweight'],
    tags: ['轻量', '极低成本', '高速'],
    description: '轻量高速版本，成本极低，适合大批量对话与轻任务。',
    context: '1M',
    inputPrice: 0.14,
    outputPrice: 0.28,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    provider: 'deepseek',
    categories: ['reasoning', 'code'],
    tags: ['思维链', '深度推理'],
    description: '具备显式思维链的深度推理模型，擅长数学、逻辑与复杂代码。',
    context: '1M',
    inputPrice: 0.14,
    outputPrice: 0.28,
  },

  // --- 小米 MiMo -----------------------------------------------------------
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    provider: 'xiaomi',
    categories: ['chat', 'reasoning'],
    tags: ['推理', '高性价比'],
    description: '小米 MiMo 旗舰版本，中文对话与推理表现均衡，价格友好。',
    context: '256K',
    inputPrice: 0.42,
    outputPrice: 0.84,
  },
  {
    id: 'mimo-v2.5',
    name: 'MiMo V2.5',
    provider: 'xiaomi',
    categories: ['chat', 'lightweight'],
    tags: ['通用', '低成本'],
    description: '标准版通用模型，覆盖日常中文对话与轻量任务。',
    context: '256K',
    inputPrice: 1,
    outputPrice: 3,
  },

  // --- 智谱 GLM ------------------------------------------------------------
  {
    id: 'glm-5.2',
    name: 'GLM-5.2',
    provider: 'zhipu',
    categories: ['chat', 'reasoning', 'code'],
    tags: ['编程旗舰', 'Agent', '长上下文'],
    description: '智谱新一代旗舰，专注编程与长程 Agent 任务，代码与推理能力对齐国际一流。',
    context: '200K',
    inputPrice: 1.12,
    outputPrice: 3.92,
    badge: 'recommended',
  },
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    provider: 'zhipu',
    categories: ['chat', 'reasoning', 'code'],
    tags: ['通用', '推理', '高性价比'],
    description: '高智能通用基座，覆盖对话、推理与代码场景，价格更友好。',
    context: '200K',
    inputPrice: 0.84,
    outputPrice: 3.36,
  },

  // --- 通义 Qwen -----------------------------------------------------------
  {
    id: 'qwen3-coder-plus',
    name: 'Qwen3 Coder Plus',
    provider: 'qwen',
    categories: ['code', 'reasoning'],
    tags: ['编码旗舰', '仓库级', 'Agent'],
    description: '通义千问代码专用旗舰，支持仓库级代码理解与长程 Agent，写码、Debug、Review 首选。',
    context: '256K',
    inputPrice: 1.03,
    outputPrice: 5.14,
    badge: 'recommended',
  },
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'qwen',
    categories: ['chat', 'reasoning'],
    tags: ['通用旗舰', '复杂推理'],
    description: '通义千问最强通用模型，擅长复杂推理与高精度长链路任务。',
    context: '256K',
    inputPrice: 0.34,
    outputPrice: 1.34,
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'qwen',
    categories: ['chat', 'code', 'lightweight'],
    tags: ['均衡', '高性价比'],
    description: '能力与成本平衡的主力模型，日常对话、代码辅助与文案撰写的高性价比之选。',
    context: '128K',
    inputPrice: 0.11,
    outputPrice: 0.28,
  },

  // --- Kimi 月之暗面 -------------------------------------------------------
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    provider: 'kimi',
    categories: ['chat', 'reasoning', 'code'],
    tags: ['旗舰', '1M 上下文', '默认开启思考'],
    description: 'Kimi 旗舰模型，原生 1M token 超长上下文，默认开启深度思考，长文档与复杂 Agent 首选。',
    context: '1M',
    inputPrice: 2.8,
    outputPrice: 14.0,
    badge: 'recommended',
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    provider: 'kimi',
    categories: ['code', 'reasoning'],
    tags: ['编码', '高性价比', 'Agent'],
    description: '面向编码与 Agent 场景的模型，写码、Debug、工具调用表现稳定，性价比高。',
    context: '256K',
    inputPrice: 0.91,
    outputPrice: 3.78,
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'kimi',
    categories: ['chat', 'multimodal'],
    tags: ['通用', '视觉', '高性价比'],
    description: '支持文本与视觉输入的通用模型，日常对话与多模态任务的高性价比之选。',
    context: '256K',
    inputPrice: 0.91,
    outputPrice: 3.78,
  },
]
