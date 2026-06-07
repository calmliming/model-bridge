import type { UsageData } from '../providers/types'
import { pool } from '../db/index'

/** USD price per 1M tokens, by model tier. */
export interface TierPrice {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

// Fixed CNY→USD conversion for DeepSeek list prices (DeepSeek quotes CNY only).
// Editable in the model_pricing table once an admin updates a row.
const CNY_TO_USD = 0.14

const cny = (yuan: number) => Math.round(yuan * CNY_TO_USD * 1e6) / 1e6

// Anthropic list prices.
const CLAUDE_TIERS: Record<'opus' | 'sonnet' | 'haiku', TierPrice> = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
}

function claudeTier(model: string): keyof typeof CLAUDE_TIERS {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('haiku')) return 'haiku'
  return 'sonnet'
}

// OpenAI list prices (approximate, per 1M tokens). Used so the stats page can
// show "subscription savings" even though the relay itself uses ChatGPT
// subscription quota — no per-token charge to the user.
const OPENAI_TIERS: Record<'gpt' | 'mini', TierPrice> = {
  gpt: { input: 2.5, output: 10, cacheWrite: 0, cacheRead: 0.3 },
  mini: { input: 0.15, output: 0.6, cacheWrite: 0, cacheRead: 0.075 },
}

function openaiTier(model: string): keyof typeof OPENAI_TIERS {
  return model.toLowerCase().includes('mini') ? 'mini' : 'gpt'
}

// Gemini list prices (approximate, per 1M tokens). Relay traffic via Code
// Assist uses the user's Google AI / Workspace quota — no per-token charge.
const GEMINI_TIERS: Record<'pro' | 'flash', TierPrice> = {
  pro: { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.31 },
  flash: { input: 0.075, output: 0.3, cacheWrite: 0, cacheRead: 0.019 },
}

function geminiTier(model: string): keyof typeof GEMINI_TIERS {
  return model.toLowerCase().includes('flash') ? 'flash' : 'pro'
}

// DeepSeek list prices in CNY/1M, converted to USD. DeepSeek has no separate
// cache-write fee — cacheWrite is 0; cacheRead is the cached-input price.
// Pro shown at the 2.5-折 / "1/4 of original" rate, which the docs describe as
// the current effective price.
const DEEPSEEK_TIERS: Record<'flash' | 'pro', TierPrice> = {
  flash: { input: cny(1), output: cny(2), cacheWrite: 0, cacheRead: cny(0.02) },
  pro: { input: cny(3), output: cny(6), cacheWrite: 0, cacheRead: cny(0.025) },
}

function deepseekTier(model: string): keyof typeof DEEPSEEK_TIERS {
  const m = model.toLowerCase()
  // deepseek-v4-flash, legacy deepseek-chat
  if (m.includes('flash') || m.includes('chat')) return 'flash'
  // deepseek-v4-pro, legacy deepseek-reasoner
  return 'pro'
}

/** Returns the built-in fallback price for a (provider, model) pair. */
function builtinPrice(provider: string, model: string): TierPrice | null {
  if (provider === 'claude') return CLAUDE_TIERS[claudeTier(model)]
  if (provider === 'openai') return OPENAI_TIERS[openaiTier(model)]
  if (provider === 'gemini') return GEMINI_TIERS[geminiTier(model)]
  if (provider === 'deepseek') return DEEPSEEK_TIERS[deepseekTier(model)]
  return null
}

/**
 * Seed rows that initPricing() inserts into model_pricing on first boot.
 * Existing rows are never overwritten — admins can edit prices freely.
 */
interface SeedRow {
  provider: string
  model: string
  price: TierPrice
}

const SEED_ROWS: SeedRow[] = [
  { provider: 'claude', model: 'opus', price: CLAUDE_TIERS.opus },
  { provider: 'claude', model: 'sonnet', price: CLAUDE_TIERS.sonnet },
  { provider: 'claude', model: 'haiku', price: CLAUDE_TIERS.haiku },
  { provider: 'openai', model: 'gpt', price: OPENAI_TIERS.gpt },
  { provider: 'openai', model: 'mini', price: OPENAI_TIERS.mini },
  { provider: 'gemini', model: 'pro', price: GEMINI_TIERS.pro },
  { provider: 'gemini', model: 'flash', price: GEMINI_TIERS.flash },
  { provider: 'deepseek', model: 'deepseek-v4-flash', price: DEEPSEEK_TIERS.flash },
  { provider: 'deepseek', model: 'deepseek-v4-pro', price: DEEPSEEK_TIERS.pro },
  { provider: 'deepseek', model: 'deepseek-chat', price: DEEPSEEK_TIERS.flash },
  { provider: 'deepseek', model: 'deepseek-reasoner', price: DEEPSEEK_TIERS.pro },
]

/** In-memory cache: "provider:model" → TierPrice (DB-loaded). */
const priceCache = new Map<string, TierPrice>()
let loaded = false

const cacheKey = (provider: string, model: string) => `${provider}:${model}`

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
  }>(
    'SELECT provider, model, input_price, output_price, cache_write_price, cache_read_price FROM model_pricing',
  )
  priceCache.clear()
  for (const row of res.rows) {
    priceCache.set(cacheKey(row.provider, row.model), {
      input: Number(row.input_price),
      output: Number(row.output_price),
      cacheWrite: Number(row.cache_write_price),
      cacheRead: Number(row.cache_read_price),
    })
  }
  loaded = true
}

export async function reloadPricing(): Promise<void> {
  await loadPricing()
}

/**
 * Inserts SEED_ROWS into model_pricing for any (provider, model) pairs that
 * are missing. Existing rows are left untouched so admin edits persist.
 */
export async function initPricing(): Promise<void> {
  for (const row of SEED_ROWS) {
    await pool.query(
      `INSERT INTO model_pricing (id, provider, model, input_price, output_price, cache_write_price, cache_read_price)
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE NOT EXISTS (SELECT 1 FROM model_pricing WHERE provider = $2 AND model = $3)`,
      [
        `${row.provider}-${row.model}`,
        row.provider,
        row.model,
        row.price.input,
        row.price.output,
        row.price.cacheWrite,
        row.price.cacheRead,
      ],
    )
  }
  await loadPricing()
}

/**
 * Resolves the price for (provider, model). Checks the DB cache first
 * (exact match, then prefix/substring match for "claude-opus-4-7" → "opus"
 * style aliases), and falls back to built-in tiers.
 */
export function resolvePrice(provider: string, model: string): TierPrice | null {
  if (!loaded) return builtinPrice(provider, model)

  // 1) exact match
  const exact = priceCache.get(cacheKey(provider, model))
  if (exact) return exact

  // 2) substring match — DB might hold "deepseek-v4-flash" while the
  //    incoming model is "deepseek-v4-flash-thinking", or DB holds
  //    "opus" while incoming is "claude-opus-4-7".
  const m = model.toLowerCase()
  for (const [key, price] of priceCache) {
    const [p, dbModel] = key.split(':', 2)
    if (p !== provider) continue
    const dm = dbModel.toLowerCase()
    if (m.includes(dm) || dm.includes(m)) return price
  }

  // 3) built-in fallback
  return builtinPrice(provider, model)
}

/** Estimates the USD cost of one request from its token usage. */
export function estimateCost(provider: string, model: string, usage: UsageData): number {
  const p = resolvePrice(provider, model)
  if (!p) return 0
  const cost =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheCreateTokens * p.cacheWrite +
      usage.cacheReadTokens * p.cacheRead) /
    1_000_000
  return Math.round(cost * 1e6) / 1e6
}
