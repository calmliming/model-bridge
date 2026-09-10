import { describe, expect, it } from 'vitest'
import { normalizeDeepseekChatCompletionsBody } from './chat-relay'

describe('normalizeDeepseekChatCompletionsBody', () => {
  it('maps non-DeepSeek model names to the default DeepSeek model', () => {
    expect(normalizeDeepseekChatCompletionsBody({ model: 'gpt-5.5', messages: [] })).toMatchObject({
      model: 'deepseek-flash',
    })
  })

  it('passes through DeepSeek model names', () => {
    expect(normalizeDeepseekChatCompletionsBody({ model: 'deepseek-v4-flash' })).toMatchObject({
      model: 'deepseek-v4-flash',
    })
    expect(normalizeDeepseekChatCompletionsBody({ model: 'deepseek-v4-flash-vision-exp' })).toMatchObject({
      model: 'deepseek-v4-flash-vision-exp',
    })
  })

  it('maps legacy reasoner alias to V4.1 Flash', () => {
    expect(normalizeDeepseekChatCompletionsBody({ model: 'deepseek-reasoner' })).toMatchObject({
      model: 'deepseek-flash',
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

  it('preserves V4.1 Flash image inputs, reasoning settings, and tools', () => {
    const body = {
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/chart.png' } }] }],
      tools: [{ type: 'function', function: { name: 'inspect_chart', parameters: { type: 'object' } } }],
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    }
    expect(normalizeDeepseekChatCompletionsBody(body)).toEqual(body)
  })
})
