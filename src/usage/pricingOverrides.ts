import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'

const amount = z.number().finite().nonnegative()
const priceSchema = z.object({
  input: amount, output: amount, cacheWrite: amount, cacheRead: amount,
  imageInput: amount.optional(), imageOutput: amount.optional(),
}).strict()
const schema = z.object({
  version: z.literal(1),
  rules: z.array(z.object({
    provider: z.enum(['openai', 'claude', 'gemini', 'antigravity', 'deepseek', 'kimi', 'minimax', 'qwen', 'zhipu', 'xiaomi', 'grok', 'sub2api']),
    model: z.string().trim().min(1).max(200),
    price: priceSchema.optional(),
    longContext: z.object({
      threshold: z.number().int().positive(),
      inputMultiplier: z.number().finite().positive(),
      outputMultiplier: z.number().finite().positive(),
    }).strict().nullable().optional(),
    serviceTierMultipliers: z.record(z.enum(['default', 'fast', 'priority', 'flex', 'ultrafast']), amount).optional(),
    effortPrices: z.record(z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']), priceSchema).optional(),
  }).strict()).max(1_000),
}).strict()

export type PricingOverride = z.infer<typeof schema>['rules'][number]
let rules: PricingOverride[] = []

/** Validate the entire file before replacing the active rules. */
export function parsePricingOverrides(text: string): PricingOverride[] {
  const parsed = schema.parse(JSON.parse(text)).rules
  const seen = new Set<string>()
  for (const rule of parsed) {
    const key = `${rule.provider}:${rule.model.toLowerCase()}`
    if (seen.has(key)) throw new Error(`duplicate pricing rule: ${key}`)
    seen.add(key)
  }
  return parsed
}

export function resolvePricingOverride(provider: string, model: string): PricingOverride | undefined {
  const matched = rules.filter(rule => {
    if (rule.provider !== provider) return false
    const pattern = rule.model.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    return new RegExp(`^${pattern}$`, 'i').test(model)
  })
  return matched.sort((a, b) => Number(a.model.includes('*')) - Number(b.model.includes('*'))
    || b.model.replaceAll('*', '').length - a.model.replaceAll('*', '').length)[0]
}

export async function reloadPricingOverrides(path: string): Promise<void> {
  if ((await stat(path)).size > 1024 * 1024) throw new Error('pricing override file exceeds 1 MiB')
  const text = await readFile(path, 'utf8')
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('pricing override file exceeds 1 MiB')
  rules = parsePricingOverrides(text)
}

export async function startPricingOverrideReload(path: string | undefined): Promise<() => Promise<void>> {
  if (!path) return async () => {}
  await reloadPricingOverrides(path)
  let pending: Promise<void> | null = null
  const timer = setInterval(() => {
    if (pending) return
    pending = reloadPricingOverrides(path).catch(() => {
      console.error('[pricing] override reload failed; keeping the last valid prices')
    }).finally(() => { pending = null })
  }, 30_000)
  timer.unref()
  return async () => { clearInterval(timer); await pending }
}
