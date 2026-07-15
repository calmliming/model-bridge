import { config } from './config'

/**
 * Epoch ms of today's 00:00 in the given IANA timezone (defaults to the
 * configured stats timezone). Used for calendar-day ("today") stat windows so
 * the boundary is anchored to a fixed timezone — e.g. Beijing — rather than the
 * server's OS clock, which is often UTC on cloud hosts.
 */
export function startOfTodayMs(timeZone: string = config.STATS_TIMEZONE): number {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  const y = get('year')
  const mo = get('month')
  const d = get('day')
  const h = get('hour')
  const mi = get('minute')
  const s = get('second')
  const nowSec = Math.floor(now.getTime() / 1000) * 1000
  // Offset (ms) such that wall-clock-in-tz === utcInstant + offset.
  const offset = Date.UTC(y, mo - 1, d, h, mi, s) - nowSec
  // True UTC instant for today's local midnight in the target timezone.
  return Date.UTC(y, mo - 1, d, 0, 0, 0) - offset
}

/**
 * Calendar day ('YYYY-MM-DD') of the given instant in the configured stats
 * timezone. Used to bucket daily usage stats so the day boundaries match the
 * "today" window computed by {@link startOfTodayMs} — rather than UTC or the
 * Postgres session timezone, which drift apart from the dashboard's notion of
 * "today" on non-UTC deployments.
 */
export function dayKeyInTz(timestampMs: number, timeZone: string = config.STATS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampMs))
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
