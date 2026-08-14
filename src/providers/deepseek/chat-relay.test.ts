import { describe, expect, it } from 'vitest'
import { normalizeDeepseekChatCompletionsBody } from './chat-relay'

describe('normalizeDeepseekChatCompletionsBody', () => {
  it('maps non-DeepSeek model names to the default DeepSeek model', () => {
    expect(normalizeDeepseekChatCompletionsBody({ model: 'gpt-5.5', messages: [] })).toMatchObject({
      model: 'deepseek-v4-pro',
    })
  })

  it('passes through DeepSeek model names', () => {
    expect(normalizeDeepseekChatCompletionsBody({ model: 'deepseek-v4-flash' })).toMatchObject({
      model: 'deepseek-v4-flash',
    })
  })

  it('maps legacy reasoner alias to V4 Flash thinking mode', () => {
    expect(normalizeDeepseekChatCompletionsBody({ model: 'deepseek-reasoner' })).toMatchObject({
      model: 'deepseek-v4-flash',
    })
  })

  it('requests stream usage while preserving existing stream options', () => {
    expect(
      normalizeDeepseekChatCompletionsBody({
        model: 'deepseek-v4-pro',
        stream: true,
        stream_options: { extra: 'keep' },
      }),
    ).toMatchObject({
      stream_options: { extra: 'keep', include_usage: true },
    })
  })
})
