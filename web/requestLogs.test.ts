import { describe, expect, it } from 'vitest'
import { logStatusLabel, logUsageLabel, safeResultUrl } from './src/requestLogs'

describe('request log presentation', () => {
  it('distinguishes submission, generation, settlement and failures', () => {
    expect(logStatusLabel({ status: 'running', taskStatus: 'submitting' })).toBe('提交中')
    expect(logStatusLabel({ status: 'running', taskStatus: null })).toBe('生成中')
    expect(logStatusLabel({ status: 'settling', taskStatus: 'succeeded' })).toBe('结算中')
    expect(logStatusLabel({ status: 'error', taskStatus: 'violation' })).toBe('失败')
  })
  it('shows video duration/resolution and image count rather than empty token totals', () => {
    const log = { kind: 'image' as const, videoSeconds: 0, videoResolution: null, imageCount: 0,
      inputTokens: 0, outputTokens: 0, cacheTokens: 0, status: 'running' as const }
    expect(logUsageLabel(log)).toBe('等待结果')
    expect(logUsageLabel({ ...log, status: 'success', imageCount: 1 })).toBe('1 张')
    expect(logUsageLabel({ ...log, kind: 'video', videoSeconds: 5, videoResolution: '1080p' })).toBe('5 秒 · 1080p')
  })
  it('only makes HTTP media results clickable', () => {
    expect(safeResultUrl('https://example.test/video.mp4')).toBe('https://example.test/video.mp4')
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'invalid']) expect(safeResultUrl(value)).toBeNull()
  })
})
