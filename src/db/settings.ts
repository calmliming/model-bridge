import { eq } from 'drizzle-orm'
import { db } from './index'
import { settings } from './schema'

/** Reads a value from the key/value settings table. */
export async function getSetting(key: string): Promise<string | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key))
  return row?.value
}

/** Inserts or updates a value in the settings table. */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
}

const REGISTRATION_ENABLED_KEY = 'registration_enabled'

/** Whether self-service registration is open. Defaults to false (closed). */
export async function isRegistrationEnabled(): Promise<boolean> {
  return (await getSetting(REGISTRATION_ENABLED_KEY)) === 'true'
}

/** Opens or closes self-service registration. */
export async function setRegistrationEnabled(enabled: boolean): Promise<void> {
  await setSetting(REGISTRATION_ENABLED_KEY, enabled ? 'true' : 'false')
}

const QUOTA_AUTOPAUSE_PERCENT_KEY = 'quota_autopause_percent'
/** 100 = pause only when a window is actually exceeded (legacy behavior). */
export const DEFAULT_QUOTA_AUTOPAUSE_PERCENT = 100

function clampPercent(value: number, min: number): number {
  return Math.max(min, Math.min(100, Math.trunc(value)))
}

/**
 * Global usage% at which an account auto-pauses (cooldown) until the breaching
 * quota window resets. 100 keeps the legacy "pause only when exceeded" behavior;
 * a lower value pauses earlier so traffic shifts off a nearly-spent account.
 */
export async function getQuotaAutopausePercent(): Promise<number> {
  const raw = await getSetting(QUOTA_AUTOPAUSE_PERCENT_KEY)
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) ? clampPercent(n, 1) : DEFAULT_QUOTA_AUTOPAUSE_PERCENT
}

/** Sets the global auto-pause threshold (clamped to 1–100). */
export async function setQuotaAutopausePercent(percent: number): Promise<void> {
  await setSetting(QUOTA_AUTOPAUSE_PERCENT_KEY, String(clampPercent(percent, 1)))
}

const OPENAI_SCHEDULING_STRATEGY_KEY = 'openai_scheduling_strategy'

/**
 * How OpenAI account fallback scheduling picks among available accounts:
 *   - `weighted_lru`        — default; weight then least-recently-used.
 *   - `prefer_soonest_reset` — prefer the account whose quota window resets
 *     soonest, so a nearly-spent account drains first and frees others.
 * Sticky sessions always take priority regardless of strategy.
 */
export type OpenAiSchedulingStrategy = 'weighted_lru' | 'prefer_soonest_reset'
export const DEFAULT_OPENAI_SCHEDULING_STRATEGY: OpenAiSchedulingStrategy = 'weighted_lru'

const OPENAI_SCHEDULING_STRATEGIES: OpenAiSchedulingStrategy[] = ['weighted_lru', 'prefer_soonest_reset']

function isOpenAiSchedulingStrategy(value: string | undefined): value is OpenAiSchedulingStrategy {
  return value != null && (OPENAI_SCHEDULING_STRATEGIES as string[]).includes(value)
}

/** Reads the OpenAI scheduling strategy, defaulting to the legacy weighted-LRU. */
export async function getOpenAiSchedulingStrategy(): Promise<OpenAiSchedulingStrategy> {
  const raw = await getSetting(OPENAI_SCHEDULING_STRATEGY_KEY)
  return isOpenAiSchedulingStrategy(raw) ? raw : DEFAULT_OPENAI_SCHEDULING_STRATEGY
}

/** Sets the OpenAI scheduling strategy (ignored if the value is unknown). */
export async function setOpenAiSchedulingStrategy(strategy: OpenAiSchedulingStrategy): Promise<void> {
  const value = isOpenAiSchedulingStrategy(strategy) ? strategy : DEFAULT_OPENAI_SCHEDULING_STRATEGY
  await setSetting(OPENAI_SCHEDULING_STRATEGY_KEY, value)
}
