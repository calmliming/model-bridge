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
