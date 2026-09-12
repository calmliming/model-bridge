import { describe, expect, it } from 'vitest'
import { DEFAULT_HEALTH_SETTINGS, healthQuerySchema, healthRow, healthSettingsSchema } from './channelHealth'
describe('channel health decisions', () => {
  it('does not call a low-sample channel healthy or alert on it', () => {
    const row = healthRow({ id: 'a', eligible: 2, failures: 2, requests: 2 }, DEFAULT_HEALTH_SETTINGS)
    expect(row.state).toBe('insufficient')
    expect(row.alerts).toEqual([])
    expect(healthRow({ id: 'empty' }, DEFAULT_HEALTH_SETTINGS).errorRatePercent).toBeNull()
  })
  it('uses eligible requests for errors and successful latency samples for latency alerts', () => {
    const row = { id: 'a', requests: 40, eligible: 20, failures: 2, canceled: 20, ttft_samples: 2, ttft_p95: 20000 }
    expect(healthRow(row, DEFAULT_HEALTH_SETTINGS)).toMatchObject({ errorRatePercent: 10, excluded: 20, alerts: ['上游错误率超阈值'] })
    expect(healthRow({ ...row, ttft_samples: 20 }, DEFAULT_HEALTH_SETTINGS).alerts).toHaveLength(2)
    expect(healthRow({ ...row, failures: 0 }, DEFAULT_HEALTH_SETTINGS).state).toBe('healthy')
  })
  it('rejects arbitrary grouping identifiers and unbounded settings', () => {
    expect(healthQuerySchema.safeParse({ groupBy: 'account; DROP TABLE accounts' }).success).toBe(false)
    expect(healthQuerySchema.safeParse({ hours: 169 }).success).toBe(false)
    expect(healthSettingsSchema.safeParse({ ...DEFAULT_HEALTH_SETTINGS, minSamples: 0 }).success).toBe(false)
  })
})
