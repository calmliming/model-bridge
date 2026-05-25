export type AccountQuotaWindowKey = 'hourly' | 'weekly' | 'weekly_sonnet' | 'primary' | 'secondary'

export interface AccountQuotaWindow {
  key: AccountQuotaWindowKey
  label: string
  usedPercent: number | null
  resetAt: number | null
  exceeded: boolean
}

export interface AccountQuotaSnapshot {
  source: 'claude' | 'openai'
  updatedAt: number
  windows: AccountQuotaWindow[]
}

function headerNumber(headers: Headers, name: string): number | null {
  const value = headers.get(name)
  if (!value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseEpochMs(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 10_000_000_000 ? Math.trunc(n) : Math.trunc(n * 1000)
}

function parseTimeMs(raw: string | null | undefined): number | null {
  if (!raw) return null
  const epoch = parseEpochMs(raw)
  if (epoch != null) return epoch
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function resetAfter(headers: Headers, name: string, now: number): number | null {
  const seconds = headerNumber(headers, name)
  return seconds == null || seconds < 0 ? null : now + seconds * 1000
}

function percentFromUtilization(value: number | null): number | null {
  if (value == null) return null
  const percent = value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, percent))
}

function percentFromLimitRemaining(limit: number | null, remaining: number | null): number | null {
  if (limit == null || remaining == null || limit <= 0) return null
  return Math.max(0, Math.min(100, ((limit - remaining) / limit) * 100))
}

function percentFromPercent(value: number | null): number | null {
  if (value == null) return null
  return Math.max(0, Math.min(100, value))
}

function parseClaudeQuota(headers: Headers, now: number): AccountQuotaSnapshot | null {
  const specs = [
    { key: 'hourly' as const, label: '5小时', prefix: 'anthropic-ratelimit-unified-5h-' },
    { key: 'weekly' as const, label: '7天', prefix: 'anthropic-ratelimit-unified-7d-' },
  ]
  const windows = specs.flatMap<AccountQuotaWindow>((spec) => {
    const utilization = headerNumber(headers, `${spec.prefix}utilization`)
    const resetAt = parseEpochMs(headers.get(`${spec.prefix}reset`))
    const exceeded = headers.get(`${spec.prefix}surpassed-threshold`)?.toLowerCase() === 'true'
    if (utilization == null && resetAt == null && !exceeded) return []
    const usedPercent = percentFromUtilization(utilization)
    return [
      {
        key: spec.key,
        label: spec.label,
        usedPercent,
        resetAt,
        exceeded: exceeded || (usedPercent != null && usedPercent >= 100),
      },
    ]
  })

  if (windows.length) return { source: 'claude', updatedAt: now, windows }

  const tokenUsedPercent = percentFromLimitRemaining(
    headerNumber(headers, 'anthropic-ratelimit-tokens-limit'),
    headerNumber(headers, 'anthropic-ratelimit-tokens-remaining'),
  )
  const tokenResetAt = parseTimeMs(headers.get('anthropic-ratelimit-tokens-reset'))
  if (tokenUsedPercent != null || tokenResetAt != null) {
    return {
      source: 'claude',
      updatedAt: now,
      windows: [
        {
          key: 'primary',
          label: 'Token',
          usedPercent: tokenUsedPercent,
          resetAt: tokenResetAt,
          exceeded: tokenUsedPercent != null && tokenUsedPercent >= 100,
        },
      ],
    }
  }

  return null
}

interface ClaudeOAuthUsageWindow {
  utilization?: unknown
  resets_at?: unknown
}

function readClaudeOAuthWindow(
  body: Record<string, unknown>,
  field: string,
  key: Extract<AccountQuotaWindowKey, 'hourly' | 'weekly' | 'weekly_sonnet'>,
  label: string,
): AccountQuotaWindow[] {
  const raw = body[field]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const row = raw as ClaudeOAuthUsageWindow
  const utilization = typeof row.utilization === 'number' ? row.utilization : null
  const resetAt = typeof row.resets_at === 'string' ? parseTimeMs(row.resets_at) : null
  if (utilization == null && resetAt == null) return []
  const usedPercent = percentFromPercent(utilization)
  return [
    {
      key,
      label,
      usedPercent,
      resetAt,
      exceeded: usedPercent != null && usedPercent >= 100,
    },
  ]
}

export function extractClaudeOAuthUsageQuota(
  body: unknown,
  now = Date.now(),
): AccountQuotaSnapshot | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const row = body as Record<string, unknown>
  const windows = [
    ...readClaudeOAuthWindow(row, 'five_hour', 'hourly', '5小时'),
    ...readClaudeOAuthWindow(row, 'seven_day', 'weekly', '7天'),
    ...readClaudeOAuthWindow(row, 'seven_day_sonnet', 'weekly_sonnet', '7天 Sonnet'),
  ]
  return windows.length ? { source: 'claude', updatedAt: now, windows } : null
}

interface CodexRawWindow {
  usedPercent: number | null
  resetAt: number | null
  windowMinutes: number | null
  hasData: boolean
}

function readCodexWindow(headers: Headers, prefix: string, now: number): CodexRawWindow {
  const usedPercent = percentFromPercent(headerNumber(headers, `${prefix}-used-percent`))
  const resetAt = resetAfter(headers, `${prefix}-reset-after-seconds`, now)
  const windowMinutes = headerNumber(headers, `${prefix}-window-minutes`)
  return {
    usedPercent,
    resetAt,
    windowMinutes,
    hasData: usedPercent != null || resetAt != null || windowMinutes != null,
  }
}

function codexQuotaWindow(
  key: Extract<AccountQuotaWindowKey, 'hourly' | 'weekly'>,
  raw: CodexRawWindow,
): AccountQuotaWindow[] {
  if (!raw.hasData) return []
  const label = key === 'hourly' ? '5小时' : '7天'
  return [
    {
      key,
      label,
      usedPercent: raw.usedPercent,
      resetAt: raw.resetAt,
      exceeded: raw.usedPercent != null && raw.usedPercent >= 100,
    },
  ]
}

function parseOpenAIQuota(headers: Headers, now: number): AccountQuotaSnapshot | null {
  const primary = readCodexWindow(headers, 'x-codex-primary', now)
  const secondary = readCodexWindow(headers, 'x-codex-secondary', now)
  if (!primary.hasData && !secondary.hasData) return null

  let primaryIs5h = false
  if (primary.windowMinutes != null && secondary.windowMinutes != null) {
    primaryIs5h = primary.windowMinutes < secondary.windowMinutes
  } else if (primary.windowMinutes != null) {
    primaryIs5h = primary.windowMinutes <= 360
  } else if (secondary.windowMinutes != null) {
    primaryIs5h = secondary.windowMinutes > 360
  }

  // Codex used to omit window-minutes; sub2api treats that legacy shape as
  // primary=7d and secondary=5h.
  const fiveHour = primaryIs5h ? primary : secondary
  const sevenDay = primaryIs5h ? secondary : primary
  const windows = [
    ...codexQuotaWindow('hourly', fiveHour),
    ...codexQuotaWindow('weekly', sevenDay),
  ]

  return windows.length ? { source: 'openai', updatedAt: now, windows } : null
}

export function extractAccountQuota(
  provider: string,
  headers: Headers,
  now = Date.now(),
): AccountQuotaSnapshot | null {
  if (provider === 'claude') return parseClaudeQuota(headers, now)
  if (provider === 'openai') return parseOpenAIQuota(headers, now)
  return null
}

export function quotaCooldownUntil(
  quota: AccountQuotaSnapshot | null | undefined,
  now = Date.now(),
): number | null {
  const resetTimes = quota?.windows
    .filter((window) => window.exceeded && window.resetAt != null && window.resetAt > now)
    .map((window) => window.resetAt!) ?? []
  return resetTimes.length ? Math.min(...resetTimes) : null
}

function isQuotaWindow(value: unknown): value is AccountQuotaWindow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<AccountQuotaWindow>
  const keys: AccountQuotaWindowKey[] = ['hourly', 'weekly', 'weekly_sonnet', 'primary', 'secondary']
  return (
    typeof row.key === 'string' &&
    keys.includes(row.key as AccountQuotaWindowKey) &&
    typeof row.label === 'string' &&
    (typeof row.usedPercent === 'number' || row.usedPercent === null) &&
    (typeof row.resetAt === 'number' || row.resetAt === null) &&
    typeof row.exceeded === 'boolean'
  )
}

export function accountQuotaFromMetadata(metadata: unknown): AccountQuotaSnapshot | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const quota = (metadata as { quota?: unknown }).quota
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) return null
  const row = quota as Partial<AccountQuotaSnapshot>
  if (row.source !== 'claude' && row.source !== 'openai') return null
  if (typeof row.updatedAt !== 'number' || !Array.isArray(row.windows)) return null
  const windows = row.windows.filter(isQuotaWindow)
  return windows.length ? { source: row.source, updatedAt: row.updatedAt, windows } : null
}
