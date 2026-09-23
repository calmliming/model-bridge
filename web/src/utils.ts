/**
 * Compactly formats a token count for limited-width cards: K/M/B suffixes with
 * 2 decimals, full digits below 1K. Shared by the overview and stats views.
 */
export function formatTokens(n: number): string {
  const value = Number.isFinite(n) ? n : 0
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return Math.round(value).toLocaleString('en-US')
}

/**
 * Formats a USD amount at a precision that keeps the value the server actually
 * recorded visible. Costs are rounded to 8 decimals server-side, and cheap
 * requests routinely land below a micro-dollar; a fixed 4- or 6-decimal format
 * renders those as $0.0000 — which reads as "free" even though the request's
 * own line items and the usage totals still count it.
 *
 * Replaces the per-view copies this used to be duplicated into (several views
 * had drifted to a hard-coded 2/4 split).
 */
export function formatUsd(n: number): string {
  const value = Number.isFinite(n) ? n : 0
  const abs = Math.abs(value)
  if (abs >= 1) return `$${value.toFixed(2)}`
  if (abs === 0) return '$0.00'
  if (abs >= 0.01) return `$${value.toFixed(4)}`
  // Sub-cent: keep two significant digits so a small charge stays legible
  // instead of collapsing into $0.0000. Capped at the server's 8 decimals.
  const decimals = Math.min(8, Math.max(4, Math.ceil(-Math.log10(abs)) + 2))
  return `$${value.toFixed(decimals)}`
}

// Server-side stats timezone (STATS_TIMEZONE), fetched once at startup. When
// set, timestamps render in this zone so a row's date always matches the day
// bucket / "today" card it was counted into; until it loads (or if the server
// sends an invalid zone) rendering falls back to the browser's local zone.
let displayTimeZone: string | undefined

/** Adopts the server's stats timezone for timestamp rendering (ignores invalid zones). */
export function setDisplayTimeZone(tz: string | null | undefined): void {
  if (!tz) return
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: tz })
    displayTimeZone = tz
  } catch {
    // Invalid IANA zone from server config — keep browser-local rendering.
  }
}

/** Formats an epoch-millisecond timestamp as a short date-time string (stats timezone). */
export function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  })
}

/** Epoch range [start, end) for a calendar day in the dashboard timezone. */
export function calendarDayRangeMs(day: string): [number, number] {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) throw new Error('invalid calendar day')
  const nextDay = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10)
  return [calendarDayStartMs(day), calendarDayStartMs(nextDay)]
}

function calendarDayStartMs(day: string): number {
  if (!displayTimeZone) return new Date(`${day}T00:00:00`).getTime()
  const [year, month, date] = day.split('-').map(Number)
  const target = Date.UTC(year!, month! - 1, date)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: displayTimeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  let instant = target
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(instant))
    const part = (type: string) => Number(parts.find((entry) => entry.type === type)!.value)
    const wallTime = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))
    const next = instant + target - wallTime
    if (next === instant) break
    instant = next
  }
  return instant
}
