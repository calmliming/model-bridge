import { afterEach, describe, expect, it } from 'vitest'

import {
  acquireSlot,
  checkRateLimit,
  currentConcurrency,
  releaseSlot,
  resetLimits,
} from './limits'

afterEach(() => resetLimits())

describe('checkRateLimit', () => {
  it('allows up to the limit within a minute, then blocks', () => {
    expect(checkRateLimit('k', 2, 1_000)).toBe(true)
    expect(checkRateLimit('k', 2, 1_100)).toBe(true)
    expect(checkRateLimit('k', 2, 1_200)).toBe(false)
  })

  it('blocked requests do not consume budget', () => {
    checkRateLimit('k', 1, 0)
    expect(checkRateLimit('k', 1, 100)).toBe(false)
    expect(checkRateLimit('k', 1, 200)).toBe(false)
  })

  it('frees budget as the window slides', () => {
    expect(checkRateLimit('k', 1, 0)).toBe(true)
    expect(checkRateLimit('k', 1, 30_000)).toBe(false)
    // 60s after the first hit, the window has moved past it.
    expect(checkRateLimit('k', 1, 60_001)).toBe(true)
  })

  it('tracks keys independently', () => {
    expect(checkRateLimit('a', 1, 0)).toBe(true)
    expect(checkRateLimit('b', 1, 0)).toBe(true)
    expect(checkRateLimit('a', 1, 1)).toBe(false)
  })
})

describe('concurrency gate', () => {
  it('acquires up to the limit then refuses', () => {
    expect(acquireSlot('k', 2)).toBe(true)
    expect(acquireSlot('k', 2)).toBe(true)
    expect(acquireSlot('k', 2)).toBe(false)
    expect(currentConcurrency('k')).toBe(2)
  })

  it('releasing frees a slot', () => {
    acquireSlot('k', 1)
    expect(acquireSlot('k', 1)).toBe(false)
    releaseSlot('k')
    expect(acquireSlot('k', 1)).toBe(true)
  })

  it('release never goes negative and cleans up at zero', () => {
    releaseSlot('k')
    expect(currentConcurrency('k')).toBe(0)
    acquireSlot('k', 5)
    releaseSlot('k')
    expect(currentConcurrency('k')).toBe(0)
  })

  it('tracks keys independently', () => {
    acquireSlot('a', 1)
    expect(acquireSlot('b', 1)).toBe(true)
    expect(currentConcurrency('a')).toBe(1)
    expect(currentConcurrency('b')).toBe(1)
  })
})
