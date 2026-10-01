import { describe, expect, it } from 'vitest'
import { calendarDayRangeMs, openAIPlanLabel, setDisplayTimeZone } from './utils'

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

describe('openAIPlanLabel', () => {
  it('maps current ChatGPT plan claims across spellings', () => {
    expect(openAIPlanLabel('plus')).toBe('Plus')
    expect(openAIPlanLabel('chatgpt_pro')).toBe('Pro 200')
    expect(openAIPlanLabel('pro')).toBe('Pro 200')
    expect(openAIPlanLabel('prolite')).toBe('Pro 100')
    expect(openAIPlanLabel('pro_max')).toBe('Pro 500')
    expect(openAIPlanLabel('team')).toBe('Business')
    expect(openAIPlanLabel('self_serve_business_prolite')).toBe('Business Premium')
    expect(openAIPlanLabel('ENTERPRISE')).toBe('Enterprise')
    expect(openAIPlanLabel('edu_plus')).toBe('Edu Plus')
  })

  it('hides empty or unknown placeholders and keeps unrecognized values', () => {
    expect(openAIPlanLabel(null)).toBe('')
    expect(openAIPlanLabel(' ')).toBe('')
    expect(openAIPlanLabel('unknown')).toBe('')
    expect(openAIPlanLabel('future_plan')).toBe('future_plan')
  })
})
