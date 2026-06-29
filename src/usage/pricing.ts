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

// ---------------------------------------------------------------------------
// Anthropic (Claude) list prices.
//
// Opus 4.5 cut list prices to 5 / 25; Opus 4.1 (and earlier 4.0 / Claude 3
// Opus) stay on the old 15 / 75. We therefore price Opus per version instead
// of as a single flat tier — otherwise every opus-4-5+ request bills 3× high.
// ---------------------------------------------------------------------------
const CLAUDE_OPUS_REDUCED: TierPrice = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }
const CLAUDE_OPUS_LEGACY: TierPrice = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }
const CLAUDE_SONNET: TierPrice = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }
const CLAUDE_HAIKU: TierPrice = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }
// Fable 5 (Mythos-class flagship) has no published per-token list price yet.
// Seed it at the current top Claude rate (Opus 4.5+ reduced) so it is never
// under-billed as the default Sonnet tier; admins can edit the row once the
// official price is known.
const CLAUDE_FABLE: TierPrice = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }

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
// OpenAI (ChatGPT / Codex) list prices, per 1M tokens.
//
// These feed estimateCost(), which charges the customer's wallet / subscription
// in recordUsage() — so they track the gpt-5.x list prices, not a flat rate.
// ---------------------------------------------------------------------------
const OPENAI_GPT55: TierPrice = { input: 5, output: 30, cacheWrite: 0, cacheRead: 0.5 }
const OPENAI_GPT54: TierPrice = { input: 2.5, output: 15, cacheWrite: 0, cacheRead: 0.25 }
const OPENAI_CODEX: TierPrice = { input: 1.5, output: 12, cacheWrite: 0, cacheRead: 0.15 }
const OPENAI_MINI: TierPrice = { input: 0.25, output: 2, cacheWrite: 0, cacheRead: 0.025 }
// gpt-5 / gpt-5.1 base tier; also the fallback for unrecognised gpt-* / o* models.
const OPENAI_GPT5: TierPrice = { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 }

function openaiPrice(model: string): TierPrice {
  const m = model.toLowerCase()
  if (m.includes('codex')) return OPENAI_CODEX
  if (m.includes('mini') || m.includes('nano')) return OPENAI_MINI
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

/** Returns the built-in fallback price for a (provider, model) pair. */
function builtinPrice(provider: string, model: string): TierPrice | null {
  if (provider === 'claude') return claudePrice(model)
  if (provider === 'openai') return openaiPrice(model)
  if (provider === 'gemini') return geminiPrice(model)
  if (provider === 'deepseek') return DEEPSEEK_TIERS[deepseekTier(model)]
  if (provider === 'xiaomi') return XIAOMI_TIERS[xiaomiTier(model)]
  if (provider === 'zhipu') return ZHIPU_TIERS[zhipuTier(model)]
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
  { provider: 'deepseek', model: 'deepseek-v4-flash', price: DEEPSEEK_TIERS.flash },
  { provider: 'deepseek', model: 'deepseek-v4-pro', price: DEEPSEEK_TIERS.pro },
  { provider: 'deepseek', model: 'deepseek-chat', price: DEEPSEEK_TIERS.flash },
  { provider: 'deepseek', model: 'deepseek-reasoner', price: DEEPSEEK_TIERS.pro },
  { provider: 'xiaomi', model: 'mimo-v2.5-pro', price: XIAOMI_TIERS.pro },
  { provider: 'xiaomi', model: 'mimo-v2.5', price: XIAOMI_TIERS.standard },
  { provider: 'zhipu', model: 'glm-5.2', price: ZHIPU_TIERS.flagship },
  { provider: 'zhipu', model: 'glm-5.1', price: ZHIPU_TIERS.base },
  { provider: 'zhipu', model: 'glm', price: ZHIPU_TIERS.base },
]

/**
 * One-time corrections for existing databases that were seeded with stale
 * generic-tier defaults. Each correction only fires when the row still holds
 * the old value — admin-customised prices are left untouched. Runs once,
 * gated by the `pricing_seed_v2` settings flag.
 */
interface SeedCorrection {
  provider: string
  model: string
  from: TierPrice
  to: TierPrice
}

const SEED_CORRECTIONS: SeedCorrection[] = [
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
 * are missing, then applies one-time SEED_CORRECTIONS to stale generic rows.
 * Existing (and admin-edited) rows are left untouched so manual prices persist.
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

  // Correct stale defaults exactly once (preserves admin customisations).
  const corrected = await pool.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'pricing_seed_v2'`,
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
      `INSERT INTO settings (key, value) VALUES ('pricing_seed_v2', '1')
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
export function resolvePrice(provider: string, model: string): TierPrice | null {
  if (!loaded) return builtinPrice(provider, model)

  // 1) exact match
  const exact = priceCache.get(cacheKey(provider, model))
  if (exact) return exact

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
    const dm = dbModel.toLowerCase()
    if ((m.includes(dm) || dm.includes(m)) && dm.length > bestLen) {
      best = price
      bestLen = dm.length
    }
  }
  if (best) return best

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
