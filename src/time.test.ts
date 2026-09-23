import { describe, expect, it } from 'vitest'
import { startOfDayMs } from './time'

describe('startOfDayMs', () => {
  it('uses the configured calendar day even when the UTC date differs', () => {
    expect(new Date(startOfDayMs('2026-09-23', 'Asia/Shanghai')).toISOString()).toBe('2026-09-22T16:00:00.000Z')
  })

  it('uses each day’s own offset around daylight saving time', () => {
    const start = startOfDayMs('2026-03-08', 'America/New_York')
    const end = startOfDayMs('2026-03-09', 'America/New_York')
    expect(new Date(start).toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(new Date(end).toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })
})
