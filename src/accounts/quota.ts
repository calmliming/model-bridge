export type AccountQuotaWindowKey = 'hourly' | 'weekly' | 'primary' | 'secondary'

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

function resetAfter(headers: Headers, name: string, now: number): number | null {
  const seconds = headerNumber(headers, name)
  return seconds == null || seconds < 0 ? null : now + seconds * 1000
}

function percentFromUtilization(value: number | null): number | null {
  if (value == null) return null
  const percent = value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, percent))
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

  return windows.length ? { source: 'claude', updatedAt: now, windows } : null
}

function parseOpenAIQuota(headers: Headers, now: number): AccountQuotaSnapshot | null {
  const specs = [
    {
      key: 'primary' as const,
      label: '主额度',
      used: 'x-codex-primary-used-percent',
      reset: 'x-codex-primary-reset-after-seconds',
    },
    {
      key: 'secondary' as const,
      label: '次额度',
      used: 'x-codex-secondary-used-percent',
      reset: 'x-codex-secondary-reset-after-seconds',
    },
  ]
  const windows = specs.flatMap<AccountQuotaWindow>((spec) => {
    const usedPercent = percentFromUtilization(headerNumber(headers, spec.used))
    const resetAt = resetAfter(headers, spec.reset, now)
    if (usedPercent == null && resetAt == null) return []
    return [
      {
        key: spec.key,
        label: spec.label,
        usedPercent,
        resetAt,
        exceeded: usedPercent != null && usedPercent >= 100,
      },
    ]
  })

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

function isQuotaWindow(value: unknown): value is AccountQuotaWindow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Partial<AccountQuotaWindow>
  const keys: AccountQuotaWindowKey[] = ['hourly', 'weekly', 'primary', 'secondary']
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
