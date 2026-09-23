import { describe, expect, it } from 'vitest'
import { calendarDayRangeMs, setDisplayTimeZone } from './utils'

describe('calendarDayRangeMs', () => {
  it('uses the configured statistics timezone and an exclusive next-day boundary', () => {
    setDisplayTimeZone('Asia/Shanghai')
    const [start, end] = calendarDayRangeMs('2026-09-23')
    expect(new Date(start).toISOString()).toBe('2026-09-22T16:00:00.000Z')
    expect(new Date(end).toISOString()).toBe('2026-09-23T16:00:00.000Z')
  })

  it('keeps calendar days correct across daylight saving changes', () => {
    setDisplayTimeZone('America/New_York')
    const [start, end] = calendarDayRangeMs('2026-03-08')
    expect(new Date(start).toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(new Date(end).toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })
})
