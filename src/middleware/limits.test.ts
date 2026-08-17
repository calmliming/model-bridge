import { afterEach, describe, expect, it } from 'vitest'

import {
  acquireSlot,
  checkRateLimit,
  checkWindowLimit,
  currentConcurrency,
  releaseSlot,
  resetLimits,
} from './limits'

afterEach(() => resetLimits())

describe('checkRateLimit', () => {
  it('allows up to the limit within a minute, then blocks', async () => {
    expect(await checkRateLimit('k', 2, 1_000)).toBe(true)
    expect(await checkRateLimit('k', 2, 1_100)).toBe(true)
    expect(await checkRateLimit('k', 2, 1_200)).toBe(false)
  })

  it('blocked requests do not consume budget', async () => {
    await checkRateLimit('k', 1, 0)
    expect(await checkRateLimit('k', 1, 100)).toBe(false)
    expect(await checkRateLimit('k', 1, 200)).toBe(false)
  })

  it('frees budget as the window slides', async () => {
    expect(await checkRateLimit('k', 1, 0)).toBe(true)
    expect(await checkRateLimit('k', 1, 30_000)).toBe(false)
    // 60s after the first hit, the window has moved past it.
    expect(await checkRateLimit('k', 1, 60_001)).toBe(true)
  })

  it('tracks keys independently', async () => {
    expect(await checkRateLimit('a', 1, 0)).toBe(true)
    expect(await checkRateLimit('b', 1, 0)).toBe(true)
    expect(await checkRateLimit('a', 1, 1)).toBe(false)
  })
})

describe('checkWindowLimit', () => {
  it('supports independent windows and returns an exact retry delay', async () => {
    expect(await checkWindowLimit('k', 1, 10_000, 1_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    })
    expect(await checkWindowLimit('k', 1, 10_000, 4_000)).toEqual({
      allowed: false,
      retryAfterMs: 7_000,
    })
    expect(await checkWindowLimit('k', 1, 20_000, 4_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    })
  })

  it('does not count blocked attempts and releases on the sliding boundary', async () => {
    await checkWindowLimit('k', 1, 1_000, 0)
    expect((await checkWindowLimit('k', 1, 1_000, 500)).allowed).toBe(false)
    expect((await checkWindowLimit('k', 1, 1_000, 900)).allowed).toBe(false)
    expect((await checkWindowLimit('k', 1, 1_000, 1_001)).allowed).toBe(true)
  })
})

describe('concurrency gate', () => {
  it('acquires up to the limit then refuses', async () => {
    expect(await acquireSlot('k', 2)).toBe(true)
    expect(await acquireSlot('k', 2)).toBe(true)
    expect(await acquireSlot('k', 2)).toBe(false)
    expect(await currentConcurrency('k')).toBe(2)
  })

  it('releasing frees a slot', async () => {
    await acquireSlot('k', 1)
    expect(await acquireSlot('k', 1)).toBe(false)
    await releaseSlot('k')
    expect(await acquireSlot('k', 1)).toBe(true)
  })

  it('release never goes negative and cleans up at zero', async () => {
    await releaseSlot('k')
    expect(await currentConcurrency('k')).toBe(0)
    await acquireSlot('k', 5)
    await releaseSlot('k')
    expect(await currentConcurrency('k')).toBe(0)
  })

  it('tracks keys independently', async () => {
    await acquireSlot('a', 1)
    expect(await acquireSlot('b', 1)).toBe(true)
    expect(await currentConcurrency('a')).toBe(1)
    expect(await currentConcurrency('b')).toBe(1)
  })
})
