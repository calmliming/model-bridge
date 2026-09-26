import { expect, it } from 'vitest'
import { createUsageSourceTracker, jsonUsageSource, trackUsageParser, bufferedUsageSource } from './usageSource'
import { createStreamParser } from './openai/usage'

it('distinguishes missing, partial, explicit zero and terminal error usage', () => {
  const parser = trackUsageParser(createStreamParser())
  expect(parser.result().usageSource).toBe('missing')
  parser.feed({ type: 'response.created', response: { usage: { input_tokens: 10 } } })
  expect(parser.result()).toMatchObject({ inputTokens: 10, usageSource: 'partial' })
  parser.feed({ type: 'response.failed', response: { usage: { input_tokens: 0, output_tokens: 0 } } })
  expect(parser.result()).toMatchObject({ inputTokens: 0, outputTokens: 0, usageSource: 'upstream' })
  expect(parser.result(true).usageSource).toBe('upstream')
})
it('handles Claude partial input and terminal usage independently of business status', () => {
  const tracker = createUsageSourceTracker()
  tracker.feed({ type: 'message_start', message: { usage: { input_tokens: 10 } } })
  expect(tracker.source()).toBe('partial')
  tracker.feed({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 5 } })
  expect(tracker.source()).toBe('upstream')
  expect(tracker.source(true)).toBe('upstream')
})
it('handles wrapped Gemini usage and ignores empty or invalid usage', () => {
  expect(jsonUsageSource({ usage: {} })).toBe('missing')
  expect(jsonUsageSource({ usage: { input_tokens: -1 } })).toBe('missing')
  expect(jsonUsageSource({ response: { usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } } })).toBe('upstream')
})
it('keeps trailing Chat usage including zero when the finish reason arrived earlier', () => {
  const text = [ { choices: [{ finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } } ]
    .map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
  expect(bufferedUsageSource(text, true)).toBe('upstream')
  expect(bufferedUsageSource('data: {"type":"response.output_text.delta","delta":"hi"}', true)).toBe('missing')
})

it('does not promote a partial Responses snapshot when the terminal has no usage', () => {
  const tracker = createUsageSourceTracker()
  tracker.feed({ type: 'response.created', response: { usage: { input_tokens: 10 } } })
  tracker.feed({ type: 'response.completed', response: { output: [] } })
  expect(tracker.source()).toBe('partial')
})

it('keeps reported partial counts across later snapshots and ignores empty usage', () => {
  const parser = trackUsageParser(createStreamParser())
  parser.feed({ type: 'response.created', response: { usage: { input_tokens: 10 } } })
  parser.feed({ type: 'response.completed', response: { usage: { output_tokens: 5 } } })
  parser.feed({ type: 'response.completed', response: { usage: {} } })
  expect(parser.result()).toMatchObject({ inputTokens: 10, outputTokens: 5, usageSource: 'upstream' })
})
