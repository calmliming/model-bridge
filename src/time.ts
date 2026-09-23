import { config } from './config'

/**
 * Epoch ms of today's 00:00 in the given IANA timezone (defaults to the
 * configured stats timezone). Used for calendar-day ("today") stat windows so
 * the boundary is anchored to a fixed timezone — e.g. Beijing — rather than the
 * server's OS clock, which is often UTC on cloud hosts.
 */
export function startOfTodayMs(timeZone: string = config.STATS_TIMEZONE): number {
  return startOfDayMs(dayKeyInTz(Date.now(), timeZone), timeZone)
}

/** Epoch ms of a YYYY-MM-DD midnight in the chosen timezone. */
export function startOfDayMs(day: string, timeZone: string = config.STATS_TIMEZONE): number {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) throw new Error('invalid calendar day')
  const target = Date.UTC(year, month - 1, date)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
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
