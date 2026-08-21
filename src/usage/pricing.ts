import type { UsageData } from '../providers/types'
import { pool } from '../db/index'

/** USD price per 1M tokens, by model tier. */
export interface TierPrice {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  /** USD per 1M image-input tokens, for GPT Image edits/variations. */
  imageInput?: number
  /** USD per 1M image-output tokens. */
  imageOutput?: number
}

// Fixed CNY→USD conversion for providers that only publish CNY list prices.
// Editable in the model_pricing table once an admin updates a row.
const CNY_TO_USD = 0.14

const cny = (yuan: number) => Math.round(yuan * CNY_TO_USD * 1e6) / 1e6

// ---------------------------------------------------------------------------
// Anthropic (Claude) list prices (as of 2026-07-25).
//
// Opus 4.5 cut list prices to 5 / 25; Opus 4.1 (and earlier 4.0 / Claude 3
// Opus) stay on the old 15 / 75. We therefore price Opus per version instead
// of as a single flat tier — otherwise every opus-4-5+ request bills 3× high.
//
// Prompt caching: Anthropic offers two cache durations (5-min at 1.25x write,
// 1-hour at 2x write). We use the 5-min rate (1.25x) as the default, which
// matches most usage patterns. Cache reads are 0.1x input across all models.
// ---------------------------------------------------------------------------
const CLAUDE_OPUS_REDUCED: TierPrice = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }
const CLAUDE_OPUS_LEGACY: TierPrice = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }
// Sonnet 5 introductory pricing ($2/$10) through August 31, 2026, then $3/$15.
// Using standard pricing here since the promo ends soon; admins can override
// the model_pricing table for the discounted rate during the promo period.
const CLAUDE_SONNET: TierPrice = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }
const CLAUDE_HAIKU: TierPrice = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }
// Fable 5 (Mythos-class flagship) — Anthropic's most capable widely released
// model, priced above the Opus tier at 10 / 50. Claude Mythos 5 shares the
// same list price. Official pricing confirmed 2026-07-25.
const CLAUDE_FABLE: TierPrice = { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 }

/** True for Opus versions that still bill at the legacy 15/75 rate (4.1 and earlier). */
function isLegacyOpus(model: string): boolean {
  const m = model.toLowerCase()
  // Dash-versioned names: claude-opus-4-1 → [4,1], claude-opus-4-5 → [4,5].
  const v = m.match(/opus-(\d+)-(\d+)/)
  if (v) {
    const major = Number(v[1])
    const minor = Number(v[2])
    return major < 4 || (major === 4 && minor < 5)
  }
  // "claude-3-opus-…" is legacy; a bare/unknown "opus" defaults to current pricing.
  return /3-opus|opus-3/.test(m)
}

function claudePrice(model: string): TierPrice {
  const m = model.toLowerCase()
  if (m.includes('fable') || m.includes('mythos')) return CLAUDE_FABLE
  if (m.includes('haiku')) return CLAUDE_HAIKU
  if (m.includes('opus')) return isLegacyOpus(m) ? CLAUDE_OPUS_LEGACY : CLAUDE_OPUS_REDUCED
  return CLAUDE_SONNET
}

// ---------------------------------------------------------------------------
// OpenAI (ChatGPT / Codex) list prices, per 1M tokens (as of 2026-07-25).
//
// These feed estimateCost(), which charges the customer's wallet / subscription
// in recordUsage() — so they track the gpt-5.x list prices, not a flat rate.
//
// Note: gpt-5.6 introduced explicit prompt-cache billing at 1.25× input for
// cache writes and 0.1× input for cache reads. Earlier models (5.5, 5.4, 5.1)
// have cacheWrite: 0 (no separate write fee) but support cacheRead discounts.
// ---------------------------------------------------------------------------
const OPENAI_GPT55: TierPrice = { input: 5, output: 30, cacheWrite: 0, cacheRead: 0.5 }
const OPENAI_GPT54: TierPrice = { input: 2.5, output: 15, cacheWrite: 0, cacheRead: 0.25 }
const OPENAI_CODEX: TierPrice = { input: 1.5, output: 12, cacheWrite: 0, cacheRead: 0.15 }
const OPENAI_MINI: TierPrice = { input: 0.25, output: 2, cacheWrite: 0, cacheRead: 0.025 }
// gpt-5 / gpt-5.1 base tier; also the fallback for unrecognised gpt-* / o* models.
const OPENAI_GPT5: TierPrice = { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 }
// gpt-5.6 family (public 2026-07-09): Sol flagship, Terra workhorse, Luna
// budget. Sol/Terra carry the same input/output list prices as gpt-5.5 / gpt-5.4
// ("more capability at the same price"); Luna is a new low-cost 1/6 production
// tier. Output is 6× input across all three; cacheRead is the standard 0.1×
// input. gpt-5.6 bills cache writes at 1.25× the input rate (first OpenAI
// tier to charge for cache writes explicitly).
const OPENAI_GPT56_SOL: TierPrice = { input: 5, output: 30, cacheWrite: 6.25, cacheRead: 0.5 }
const OPENAI_GPT56_TERRA: TierPrice = { input: 2.5, output: 15, cacheWrite: 3.125, cacheRead: 0.25 }
const OPENAI_GPT56_LUNA: TierPrice = { input: 1, output: 6, cacheWrite: 1.25, cacheRead: 0.1 }
const OPENAI_IMAGE_2: TierPrice = {
  input: 5,
  output: 10,
  cacheWrite: 0,
  cacheRead: 1.25,
  imageInput: 8,
  imageOutput: 30,
}
const OPENAI_IMAGE_15: TierPrice = {
  input: 5,
  output: 10,
  cacheWrite: 0,
  cacheRead: 1.25,
  imageInput: 8,
  imageOutput: 32,
}
const OPENAI_IMAGE_1: TierPrice = {
  input: 5,
  output: 0,
  cacheWrite: 0,
  cacheRead: 1.25,
  imageInput: 10,
  imageOutput: 40,
}
const OPENAI_IMAGE_MINI: TierPrice = {
  input: 2,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0.2,
  imageInput: 2.5,
  imageOutput: 8,
}

function openaiPrice(model: string): TierPrice {
  const m = model.toLowerCase()
  if (m.startsWith('gpt-image-2')) return OPENAI_IMAGE_2
  if (m.startsWith('gpt-image-1.5')) return OPENAI_IMAGE_15
  if (m.startsWith('gpt-image-1-mini')) return OPENAI_IMAGE_MINI
  if (m.startsWith('gpt-image-1')) return OPENAI_IMAGE_1
  if (m.includes('codex')) return OPENAI_CODEX
  if (m.includes('mini') || m.includes('nano')) return OPENAI_MINI
  // gpt-5.6 family: luna (budget) / terra (workhorse) / sol (flagship, and the
  // default for a bare "gpt-5.6"). Checked before the 5.5/5.4 tiers below.
  if (m.includes('5.6') || m.includes('5-6')) {
    if (m.includes('luna')) return OPENAI_GPT56_LUNA
    if (m.includes('terra')) return OPENAI_GPT56_TERRA
    return OPENAI_GPT56_SOL
  }
  if (m.includes('5.5') || m.includes('5-5')) return OPENAI_GPT55
  if (m.includes('5.4') || m.includes('5-4')) return OPENAI_GPT54
  return OPENAI_GPT5
}

// ---------------------------------------------------------------------------
// Gemini list prices, per 1M tokens. Same billing path as OpenAI above.
// gemini-2.5-flash is 0.30 / 2.50 — not the old 1.5/2.0-flash rate.
// ---------------------------------------------------------------------------
const GEMINI_PRO: TierPrice = { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.31 }
const GEMINI_FLASH: TierPrice = { input: 0.3, output: 2.5, cacheWrite: 0, cacheRead: 0.075 }

function geminiPrice(model: string): TierPrice {
  return model.toLowerCase().includes('flash') ? GEMINI_FLASH : GEMINI_PRO
}

// DeepSeek list prices per 1M tokens. Peak/off-peak billing takes effect at
// 2026-08-16 16:00 UTC. Peak windows are 01:00-04:00 and 06:00-10:00 UTC;
// every other hour is off-peak. There is no separate cache-write fee.
type DeepseekTier = 'flash' | 'pro'
type DeepseekPricePeriod = 'pre-schedule' | 'off-peak' | 'peak'

const DEEPSEEK_SCHEDULE_EFFECTIVE_AT = Date.parse('2026-08-16T16:00:00Z')
const DEEPSEEK_PEAK_WINDOWS_UTC: ReadonlyArray<readonly [number, number]> = [
  [1, 4],
  [6, 10],
]

const DEEPSEEK_PRE_SCHEDULE_TIERS: Record<DeepseekTier, TierPrice> = {
  flash: { input: cny(1), output: cny(2), cacheWrite: 0, cacheRead: cny(0.02) },
  pro: { input: 0.435, output: 0.87, cacheWrite: 0, cacheRead: 0.003625 },
}
const DEEPSEEK_STALE_PRO_PRICE: TierPrice = {
  input: 0.42,
  output: 0.84,
  cacheWrite: 0,
  cacheRead: 0.0035,
}

const DEEPSEEK_SCHEDULED_TIERS: Record<Exclude<DeepseekPricePeriod, 'pre-schedule'>, Record<DeepseekTier, TierPrice>> = {
  'off-peak': {
    flash: { input: 0.22, output: 0.66, cacheWrite: 0, cacheRead: 0.007 },
    pro: { input: 0.66, output: 1.98, cacheWrite: 0, cacheRead: 0.022 },
  },
  peak: {
    flash: { input: 0.44, output: 1.32, cacheWrite: 0, cacheRead: 0.014 },
    pro: { input: 1.32, output: 3.96, cacheWrite: 0, cacheRead: 0.044 },
  },
}

function deepseekTier(model: string): DeepseekTier {
  const m = model.toLowerCase()
  // deepseek-v4-flash plus legacy deepseek-chat / deepseek-reasoner aliases.
  if (m.includes('flash') || m.includes('chat') || m.includes('reasoner')) return 'flash'
  // deepseek-v4-pro
  return 'pro'
}

function deepseekPricePeriod(atMs: number): DeepseekPricePeriod {
  if (atMs < DEEPSEEK_SCHEDULE_EFFECTIVE_AT) return 'pre-schedule'
  const hour = new Date(atMs).getUTCHours()
  return DEEPSEEK_PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end)
    ? 'peak'
    : 'off-peak'
}

function deepseekPrice(model: string, atMs: number): TierPrice {
  const tier = deepseekTier(model)
  const period = deepseekPricePeriod(atMs)
  return period === 'pre-schedule'
    ? DEEPSEEK_PRE_SCHEDULE_TIERS[tier]
    : DEEPSEEK_SCHEDULED_TIERS[period][tier]
}

// Xiaomi MiMo V2.5 list prices (per 1M tokens). MiMo-V2.5-Pro uses the official
// CNY rate (3 / 6 CNY, cache-hit input 0.025 CNY) converted to USD; the standard
// MiMo-V2.5 uses the international USD rate ($1 / $3, cached $0.2). MiMo has no
// separate cache-write fee — cacheWrite is 0; cacheRead is the cached-input price.
const XIAOMI_TIERS: Record<'standard' | 'pro', TierPrice> = {
  standard: { input: 1, output: 3, cacheWrite: 0, cacheRead: 0.2 },
  pro: { input: cny(3), output: cny(6), cacheWrite: 0, cacheRead: cny(0.025) },
}

function xiaomiTier(model: string): keyof typeof XIAOMI_TIERS {
  // mimo-v2.5-pro (and legacy mimo-v2-pro) → pro; mimo-v2.5 / flash / omni → standard
  return model.toLowerCase().includes('pro') ? 'pro' : 'standard'
}

// Zhipu GLM list prices (per 1M tokens), quoted in CNY on the BigModel pricing
// page and converted to USD. GLM has no separate cache-write fee — cacheWrite
// is 0; cacheRead is the cache-hit input price. Flagship is glm-5.2 (8 / 28,
// cache-hit 2 CNY); the cheaper base tier is glm-5.1 (6 / 24, cache-hit ~1.5 CNY).
const ZHIPU_TIERS: Record<'base' | 'flagship', TierPrice> = {
  base: { input: cny(6), output: cny(24), cacheWrite: 0, cacheRead: cny(1.5) },
  flagship: { input: cny(8), output: cny(28), cacheWrite: 0, cacheRead: cny(2) },
}

function zhipuTier(model: string): keyof typeof ZHIPU_TIERS {
  // glm-5.2 → flagship; glm-5.1 / glm-5 / other glm-* → base.
  return model.toLowerCase().includes('5.2') ? 'flagship' : 'base'
}

// Qwen (通义千问 / 阿里百炼) list prices (per 1M tokens), quoted in CNY on the
// Bailian pricing page and converted to USD. No separate cache-write fee —
// cacheWrite 0; cacheRead is an estimated cache-hit input rate (~0.2x input).
// qwen3-coder-plus is the repo-level coding flagship; qwen-max / qwen-plus are
// the stable general / value aliases.
const QWEN_TIERS: Record<'coder' | 'max' | 'plus', TierPrice> = {
  coder: { input: cny(7.34), output: cny(36.7), cacheWrite: 0, cacheRead: cny(1.47) },
  max: { input: cny(2.4), output: cny(9.6), cacheWrite: 0, cacheRead: cny(0.48) },
  plus: { input: cny(0.8), output: cny(2), cacheWrite: 0, cacheRead: cny(0.16) },
}

function qwenTier(model: string): keyof typeof QWEN_TIERS {
  const m = model.toLowerCase()
  if (m.includes('coder')) return 'coder'
  // qwen-plus / qwen-turbo / qwen-flash / qwen-long → cheap balanced tier.
  if (m.includes('plus') || m.includes('turbo') || m.includes('flash') || m.includes('long')) return 'plus'
  // qwen-max / qwen3-max / other → flagship general tier.
  return 'max'
}

// Kimi (月之暗面 / Moonshot) list prices (per 1M tokens), quoted in CNY on the
// platform.kimi.com pricing pages and converted to USD. No separate cache-write
// fee — cacheWrite is 0; cacheRead is the cache-hit input price. kimi-k3 is the
// 1M-context flagship (¥20 / ¥100, cache-hit ¥2); the k2 family (k2.7-code /
// k2.6 / k2.5, and the retiring moonshot-v1-*) is the cheaper tier
// (¥6.5 / ¥27, cache-hit ~¥1.3).
const KIMI_TIERS: Record<'k3' | 'k2', TierPrice> = {
  k3: { input: cny(20), output: cny(100), cacheWrite: 0, cacheRead: cny(2) },
  k2: { input: cny(6.5), output: cny(27), cacheWrite: 0, cacheRead: cny(1.3) },
}

function kimiTier(model: string): keyof typeof KIMI_TIERS {
  // kimi-k3 (incl. the kimi-k3[1m] 1M-context form) → flagship; everything else
  // (kimi-k2.x, moonshot-v1-*) → the cheaper k2 tier.
  return model.toLowerCase().includes('k3') ? 'k3' : 'k2'
}

// xAI (Grok) list prices per 1M tokens. No separate cache-write fee —
// cacheWrite is 0; cacheRead is the cached-input rate.
const GROK_46: TierPrice = { input: 2, output: 6, cacheWrite: 0, cacheRead: 0.5 }
const GROK_45: TierPrice = { input: 2, output: 6, cacheWrite: 0, cacheRead: 0.3 }
const GROK_43: TierPrice = { input: 1.25, output: 2.5, cacheWrite: 0, cacheRead: 0.2 }
const GROK_BUILD: TierPrice = { input: 1, output: 2, cacheWrite: 0, cacheRead: 0.2 }

function grokPrice(model: string): TierPrice {
  const m = model.toLowerCase()
  if (m.includes('build') || m.includes('code')) return GROK_BUILD
  if (m.includes('4.3') || m.includes('4-3')) return GROK_43
  if (m.includes('4.6') || m.includes('4-6')) return GROK_46
  // grok-4.5 flagship, and the default for a bare "grok".
  return GROK_45
}

function sub2apiPrice(model: string, atMs: number): TierPrice {
  const m = model.toLowerCase()
  if (m.startsWith('claude-')) return claudePrice(model)
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3')) return openaiPrice(model)
  if (m.startsWith('gemini-')) return geminiPrice(model)
  if (m.startsWith('deepseek-')) return deepseekPrice(model, atMs)
  if (m.startsWith('mimo-')) return XIAOMI_TIERS[xiaomiTier(model)]
  if (m.startsWith('glm-')) return ZHIPU_TIERS[zhipuTier(model)]
  if (m.startsWith('qwen')) return QWEN_TIERS[qwenTier(model)]
  if (m.startsWith('kimi') || m.startsWith('moonshot')) return KIMI_TIERS[kimiTier(model)]
  if (m.startsWith('grok')) return grokPrice(model)
  return CLAUDE_SONNET
}

/** Returns the built-in fallback price for a (provider, model) pair. */
function builtinPrice(provider: string, model: string, atMs: number): TierPrice | null {
  if (provider === 'claude') return claudePrice(model)
  if (provider === 'openai') return openaiPrice(model)
  if (provider === 'gemini') return geminiPrice(model)
  if (provider === 'deepseek') return deepseekPrice(model, atMs)
  if (provider === 'xiaomi') return XIAOMI_TIERS[xiaomiTier(model)]
  if (provider === 'zhipu') return ZHIPU_TIERS[zhipuTier(model)]
  if (provider === 'qwen') return QWEN_TIERS[qwenTier(model)]
  if (provider === 'kimi') return KIMI_TIERS[kimiTier(model)]
  if (provider === 'grok') return grokPrice(model)
  if (provider === 'sub2api') return sub2apiPrice(model, atMs)
  return null
}

/**
 * Seed rows that initPricing() inserts into model_pricing on first boot.
 * Existing rows are never overwritten — admins can edit prices freely.
 *
 * Each discoverable model name (see modelDiscovery.DEFAULT_MODELS) gets an
 * exact row so resolvePrice()'s exact match wins; the generic tier rows
 * ("opus", "gpt", "flash", …) cover any other version a client sends.
 */
interface SeedRow {
  provider: string
  model: string
  price: TierPrice
}

const SEED_ROWS: SeedRow[] = [
  // Claude — generic tiers + the legacy Opus 4.1 exception.
  { provider: 'claude', model: 'opus', price: CLAUDE_OPUS_REDUCED },
  { provider: 'claude', model: 'claude-opus-4-1', price: CLAUDE_OPUS_LEGACY },
  { provider: 'claude', model: 'sonnet', price: CLAUDE_SONNET },
  { provider: 'claude', model: 'haiku', price: CLAUDE_HAIKU },
  { provider: 'claude', model: 'fable', price: CLAUDE_FABLE },
  // OpenAI — exact rows for the discoverable models + generic fallbacks.
  { provider: 'openai', model: 'gpt-5.6-sol', price: OPENAI_GPT56_SOL },
  { provider: 'openai', model: 'gpt-5.6-terra', price: OPENAI_GPT56_TERRA },
  { provider: 'openai', model: 'gpt-5.6-luna', price: OPENAI_GPT56_LUNA },
  { provider: 'openai', model: 'gpt-image-2', price: OPENAI_IMAGE_2 },
  { provider: 'openai', model: 'gpt-image-1.5', price: OPENAI_IMAGE_15 },
  { provider: 'openai', model: 'gpt-image-1', price: OPENAI_IMAGE_1 },
  { provider: 'openai', model: 'gpt-image-1-mini', price: OPENAI_IMAGE_MINI },
  { provider: 'openai', model: 'gpt-5.5', price: OPENAI_GPT55 },
  { provider: 'openai', model: 'gpt-5.4', price: OPENAI_GPT54 },
  { provider: 'openai', model: 'gpt-5.4-mini', price: OPENAI_MINI },
  { provider: 'openai', model: 'gpt-5.3-codex', price: OPENAI_CODEX },
  { provider: 'openai', model: 'gpt', price: OPENAI_GPT5 },
  { provider: 'openai', model: 'mini', price: OPENAI_MINI },
  // Gemini — exact rows for the discoverable models + generic fallbacks.
  { provider: 'gemini', model: 'gemini-2.5-pro', price: GEMINI_PRO },
  { provider: 'gemini', model: 'gemini-2.5-flash', price: GEMINI_FLASH },
  { provider: 'gemini', model: 'pro', price: GEMINI_PRO },
  { provider: 'gemini', model: 'flash', price: GEMINI_FLASH },
  // DeepSeek / Xiaomi.
  // DeepSeek keeps the pre-schedule values as seed markers. resolvePrice()
  // recognises these exact values as managed defaults and applies the current
  // scheduled rate; any administrator-edited value still wins.
  { provider: 'deepseek', model: 'deepseek-v4-flash', price: DEEPSEEK_PRE_SCHEDULE_TIERS.flash },
  { provider: 'deepseek', model: 'deepseek-v4-pro', price: DEEPSEEK_PRE_SCHEDULE_TIERS.pro },
  { provider: 'deepseek', model: 'deepseek-chat', price: DEEPSEEK_PRE_SCHEDULE_TIERS.flash },
  { provider: 'deepseek', model: 'deepseek-reasoner', price: DEEPSEEK_PRE_SCHEDULE_TIERS.flash },
  { provider: 'xiaomi', model: 'mimo-v2.5-pro', price: XIAOMI_TIERS.pro },
  { provider: 'xiaomi', model: 'mimo-v2.5', price: XIAOMI_TIERS.standard },
  { provider: 'zhipu', model: 'glm-5.2', price: ZHIPU_TIERS.flagship },
  { provider: 'zhipu', model: 'glm-5.1', price: ZHIPU_TIERS.base },
  { provider: 'zhipu', model: 'glm', price: ZHIPU_TIERS.base },
  // Exact rows only — no generic 'qwen' row, because the granular qwenTier()
  // builtin fallback prices other qwen-* variants (turbo/flash/long/3-max) more
  // accurately than a broad substring row would.
  { provider: 'qwen', model: 'qwen3-coder-plus', price: QWEN_TIERS.coder },
  { provider: 'qwen', model: 'qwen-max', price: QWEN_TIERS.max },
  { provider: 'qwen', model: 'qwen-plus', price: QWEN_TIERS.plus },
  // Kimi — exact rows for the discoverable models; kimiTier() covers other
  // kimi-* / moonshot-* variants via substring tiers.
  { provider: 'kimi', model: 'kimi-k3', price: KIMI_TIERS.k3 },
  { provider: 'kimi', model: 'kimi-k2.7-code', price: KIMI_TIERS.k2 },
  { provider: 'kimi', model: 'kimi-k2.6', price: KIMI_TIERS.k2 },
  // Grok (xAI) — exact rows for the discoverable models; grokPrice() covers
  // other grok-* variants via substring tiers.
  { provider: 'grok', model: 'grok-4.6', price: GROK_46 },
  { provider: 'grok', model: 'grok-4.5', price: GROK_45 },
  { provider: 'grok', model: 'grok-4.3', price: GROK_43 },
  { provider: 'grok', model: 'grok-build-0.1', price: GROK_BUILD },
]

/**
 * One-time corrections for existing databases that were seeded with stale
 * generic-tier defaults. Each correction only fires when the row still holds
 * the old value — admin-customised prices are left untouched. Runs once,
 * gated by the `pricing_seed_v7` settings flag.
 */
interface SeedCorrection {
  provider: string
  model: string
  from: TierPrice
  to: TierPrice
}

const SEED_CORRECTIONS: SeedCorrection[] = [
  // Sub2API v0.1.179 documents Grok 4.5 cached input at $0.30/MTok. Only
  // correct the old built-in value; an administrator override remains intact.
  {
    provider: 'grok',
    model: 'grok-4.5',
    from: { input: 2, output: 6, cacheWrite: 0, cacheRead: 0.5 },
    to: GROK_45,
  },
  // Opus 4.5 dropped list prices; the generic "opus" tier was seeded at 15/75.
  {
    provider: 'claude',
    model: 'opus',
    from: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
    to: CLAUDE_OPUS_REDUCED,
  },
  // OpenAI moved off the GPT-4o-era flat rate to the gpt-5.x list prices.
  {
    provider: 'openai',
    model: 'gpt',
    from: { input: 2.5, output: 10, cacheWrite: 0, cacheRead: 0.3 },
    to: OPENAI_GPT5,
  },
  {
    provider: 'openai',
    model: 'mini',
    from: { input: 0.15, output: 0.6, cacheWrite: 0, cacheRead: 0.075 },
    to: OPENAI_MINI,
  },
  // Gemini 2.5 Flash is 0.30/2.50; the old seed used the 1.5/2.0-flash rate.
  {
    provider: 'gemini',
    model: 'flash',
    from: { input: 0.075, output: 0.3, cacheWrite: 0, cacheRead: 0.019 },
    to: GEMINI_FLASH,
  },
  // Fable 5 now has a published list price (10/50); it was seeded at the Opus
  // reduced rate (5/25) while unpriced.
  {
    provider: 'claude',
    model: 'fable',
    from: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
    to: CLAUDE_FABLE,
  },
  // gpt-5.6 introduced billed cache writes (1.25× input); the tiers were seeded
  // with cacheWrite=0 before that. Only rows still at the zero-write default are
  // corrected, so admin-set prices persist.
  {
    provider: 'openai',
    model: 'gpt-5.6-sol',
    from: { input: 5, output: 30, cacheWrite: 0, cacheRead: 0.5 },
    to: OPENAI_GPT56_SOL,
  },
  {
    provider: 'openai',
    model: 'gpt-5.6-terra',
    from: { input: 2.5, output: 15, cacheWrite: 0, cacheRead: 0.25 },
    to: OPENAI_GPT56_TERRA,
  },
  {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    from: { input: 1, output: 6, cacheWrite: 0, cacheRead: 0.1 },
    to: OPENAI_GPT56_LUNA,
  },
  {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    from: DEEPSEEK_STALE_PRO_PRICE,
    to: DEEPSEEK_PRE_SCHEDULE_TIERS.pro,
  },
  {
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    from: DEEPSEEK_STALE_PRO_PRICE,
    to: DEEPSEEK_PRE_SCHEDULE_TIERS.flash,
  },
]

/** In-memory cache: "provider:model" → TierPrice (DB-loaded). */
const priceCache = new Map<string, TierPrice>()
let loaded = false

const cacheKey = (provider: string, model: string) => `${provider}:${model}`

function sameTokenPrice(a: TierPrice, b: TierPrice): boolean {
  return (
    Math.abs(a.input - b.input) < 1e-9 &&
    Math.abs(a.output - b.output) < 1e-9 &&
    Math.abs(a.cacheWrite - b.cacheWrite) < 1e-9 &&
    Math.abs(a.cacheRead - b.cacheRead) < 1e-9
  )
}

/**
 * DeepSeek rows seeded by older releases contain the price that was current at
 * the time. Treat those exact tuples as managed defaults so they do not mask
 * the official schedule. Any other DB value remains an administrator override.
 */
function isManagedDeepseekDefault(provider: string, model: string, price: TierPrice): boolean {
  if (provider !== 'deepseek') return false
  const tier = deepseekTier(model)
  if (sameTokenPrice(price, DEEPSEEK_PRE_SCHEDULE_TIERS[tier])) return true
  return (tier === 'pro' || model.toLowerCase().includes('reasoner')) &&
    sameTokenPrice(price, DEEPSEEK_STALE_PRO_PRICE)
}

/**
 * Loads model_pricing rows into the in-memory cache. Idempotent — call
 * reloadPricing() to force a refresh (e.g. after admin edits).
 */
export async function loadPricing(): Promise<void> {
  const res = await pool.query<{
    provider: string
    model: string
    input_price: number
    output_price: number
    cache_write_price: number
    cache_read_price: number
    image_input_price: number
    image_output_price: number
  }>(
    `SELECT provider, model, input_price, output_price, cache_write_price, cache_read_price,
            image_input_price, image_output_price
       FROM model_pricing`,
  )
  priceCache.clear()
  for (const row of res.rows) {
    priceCache.set(cacheKey(row.provider, row.model), {
      input: Number(row.input_price),
      output: Number(row.output_price),
      cacheWrite: Number(row.cache_write_price),
      cacheRead: Number(row.cache_read_price),
      imageInput: Number(row.image_input_price),
      imageOutput: Number(row.image_output_price),
    })
  }
  loaded = true
}

export async function reloadPricing(): Promise<void> {
  await loadPricing()
}

/**
 * Inserts SEED_ROWS into model_pricing for any (provider, model) pairs that
 * are missing, then applies one-time SEED_CORRECTIONS to stale generic rows.
 * Existing (and admin-edited) rows are left untouched so manual prices persist.
 */
export async function initPricing(): Promise<void> {
  for (const row of SEED_ROWS) {
    await pool.query(
      `INSERT INTO model_pricing
         (id, provider, model, input_price, output_price, cache_write_price, cache_read_price,
          image_input_price, image_output_price)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
       WHERE NOT EXISTS (SELECT 1 FROM model_pricing WHERE provider = $2 AND model = $3)`,
      [
        `${row.provider}-${row.model}`,
        row.provider,
        row.model,
        row.price.input,
        row.price.output,
        row.price.cacheWrite,
        row.price.cacheRead,
        row.price.imageInput ?? 0,
        row.price.imageOutput ?? 0,
      ],
    )
  }

  // Correct stale defaults exactly once (preserves admin customisations).
  const corrected = await pool.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'pricing_seed_v7'`,
  )
  if (corrected.rows[0]?.value !== '1') {
    for (const fix of SEED_CORRECTIONS) {
      await pool.query(
        `UPDATE model_pricing
            SET input_price = $3, output_price = $4, cache_write_price = $5, cache_read_price = $6
          WHERE provider = $1 AND model = $2
            AND abs(input_price - $7) < 1e-6
            AND abs(output_price - $8) < 1e-6
            AND abs(cache_write_price - $9) < 1e-6
            AND abs(cache_read_price - $10) < 1e-6`,
        [
          fix.provider,
          fix.model,
          fix.to.input,
          fix.to.output,
          fix.to.cacheWrite,
          fix.to.cacheRead,
          fix.from.input,
          fix.from.output,
          fix.from.cacheWrite,
          fix.from.cacheRead,
        ],
      )
    }
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('pricing_seed_v7', '1')
       ON CONFLICT (key) DO UPDATE SET value = '1'`,
    )
  }

  await loadPricing()
}

/**
 * Resolves the price for (provider, model). Checks the DB cache first
 * (exact match, then the most specific prefix/substring alias — e.g.
 * "claude-opus-4-1" beats the generic "opus" for that model), and falls
 * back to the built-in tiers.
 */
export function resolvePrice(provider: string, model: string, atMs = Date.now()): TierPrice | null {
  if (!loaded) return builtinPrice(provider, model, atMs)

  // 1) exact match
  const exact = priceCache.get(cacheKey(provider, model))
  if (exact && !isManagedDeepseekDefault(provider, model, exact)) return exact

  // 2) substring match — DB might hold "deepseek-v4-flash" while the incoming
  //    model is "deepseek-v4-flash-thinking", or hold "opus" while incoming is
  //    "claude-opus-4-7". Prefer the longest (most specific) matching key so a
  //    version-specific row wins over a generic tier row.
  const m = model.toLowerCase()
  let best: TierPrice | null = null
  let bestLen = -1
  for (const [key, price] of priceCache) {
    const [p, dbModel] = key.split(':', 2)
    if (p !== provider) continue
    if (isManagedDeepseekDefault(provider, dbModel, price)) continue
    const dm = dbModel.toLowerCase()
    if ((m.includes(dm) || dm.includes(m)) && dm.length > bestLen) {
      best = price
      bestLen = dm.length
    }
  }
  if (best) return best

  // 3) built-in fallback
  return builtinPrice(provider, model, atMs)
}

/** Estimates the USD cost of one request from its token usage. */
export function estimateCost(provider: string, model: string, usage: UsageData, atMs = Date.now()): number {
  const p = resolvePrice(provider, model, atMs)
  if (!p) return 0
  const imagePrice = usage.imageModel ? resolvePrice(provider, usage.imageModel, atMs) : p
  const cost =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheCreateTokens * p.cacheWrite +
      usage.cacheReadTokens * p.cacheRead +
      (usage.imageInputTokens ?? 0) * (imagePrice?.imageInput ?? 0) +
      (usage.imageOutputTokens ?? 0) * (imagePrice?.imageOutput ?? 0)) /
    1_000_000
  return Math.round(cost * 1e6) / 1e6
}
