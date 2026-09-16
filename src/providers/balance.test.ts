import { describe, expect, it } from 'vitest'
import {
  balanceSnapshotFromMetadata,
  formatBalanceInfo,
  usesUpstreamBalance,
  upstreamBalanceFromMetadata,
  type AccountBalanceInfo,
} from './balance'

describe('usesUpstreamBalance', () => {
  it('covers the providers with a monetary balance endpoint', () => {
    expect(usesUpstreamBalance('deepseek')).toBe(true)
    expect(usesUpstreamBalance('sub2api')).toBe(true)
  })

  it('leaves quota-window providers on the generic route', () => {
    for (const provider of ['claude', 'openai', 'gemini', 'antigravity', 'minimax', 'grok', 'kimi']) {
      expect(usesUpstreamBalance(provider)).toBe(false)
    }
  })
})

describe('upstreamBalanceFromMetadata', () => {
  it('keeps only validated snapshot fields and preserves zero', () => {
    expect(upstreamBalanceFromMetadata({
      upstreamBalance: {
        updatedAt: '1700000000123',
        totalBalance: '100',
        used: '40',
        remaining: 0,
        granted: '5',
        resetAt: '1700001000000',
        expiresAt: '1700002000000',
        hasSubscription: true,
        planName: 'Pro',
        currency: 'CNY',
        mode: 'quota_limited',
        endpoint: '/user/balance',
        provider: 'deepseek',
        ignored: 'secret',
      },
    })).toEqual({
      updatedAt: 1_700_000_000_123,
      totalBalance: 100,
      used: 40,
      remaining: 0,
      granted: 5,
      resetAt: 1_700_001_000_000,
      expiresAt: 1_700_002_000_000,
      hasSubscription: true,
      planName: 'Pro',
      currency: 'CNY',
      mode: 'quota_limited',
      endpoint: '/user/balance',
      provider: 'deepseek',
    })
  })

  it('reads snapshots persisted under the legacy sub2apiBalance key', () => {
    expect(upstreamBalanceFromMetadata({
      sub2apiBalance: { updatedAt: 1_700_000_000_000, remaining: 12.5 },
    })).toEqual({ updatedAt: 1_700_000_000_000, remaining: 12.5 })
  })

  it('accepts an official mode and an exhausted wallet without a monetary amount', () => {
    expect(upstreamBalanceFromMetadata({
      upstreamBalance: { updatedAt: 1_700_000_000_000, mode: 'quota_limited' },
    })).toEqual({ updatedAt: 1_700_000_000_000, mode: 'quota_limited' })
    expect(upstreamBalanceFromMetadata({
      upstreamBalance: { updatedAt: 1_700_000_000_000, available: false },
    })).toEqual({ updatedAt: 1_700_000_000_000, available: false })
  })

  it.each([
    {},
    { upstreamBalance: { updatedAt: 0, remaining: 1 } },
    { upstreamBalance: { updatedAt: Number.POSITIVE_INFINITY, remaining: 1 } },
    { upstreamBalance: { updatedAt: 1_700_000_000_000, mode: 'unknown' } },
  ])('rejects invalid metadata snapshots', (metadata) => {
    expect(upstreamBalanceFromMetadata(metadata)).toBeNull()
  })

  it('only reports a key it was asked for', () => {
    expect(balanceSnapshotFromMetadata(
      { sub2apiBalance: { updatedAt: 1, remaining: 1 } },
      'sub2apiBalance',
    )).toEqual({ updatedAt: 1, remaining: 1 })
    expect(balanceSnapshotFromMetadata({ sub2apiBalance: { updatedAt: 1, remaining: 1 } })).toBeNull()
  })
})

describe('formatBalanceInfo', () => {
  it('summarizes a DeepSeek wallet including the granted credit', () => {
    const info: AccountBalanceInfo = {
      remaining: 110,
      totalBalance: 110,
      granted: 10,
      currency: 'CNY',
    }

    expect(formatBalanceInfo(info)).toContain('剩余: $110.00')
    expect(formatBalanceInfo(info)).toContain('赠送: $10.00')
  })

  it('calls out an exhausted wallet and an unlimited plan', () => {
    expect(formatBalanceInfo({ remaining: 0, available: false })).toBe('余额不足，上游已停止服务')
    expect(formatBalanceInfo({ unlimited: true })).toBe('不限额')
    expect(formatBalanceInfo(null)).toBe('无法获取余额信息')
    expect(formatBalanceInfo({})).toBe('无余额信息')
  })
})
