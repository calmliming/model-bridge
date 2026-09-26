import { describe, expect, it } from 'vitest'
import { createKimiResponsesStreamTransform } from './kimi/stream'
import { createQwenResponsesStreamTransform } from './qwen/stream'
import { createXiaomiResponsesStreamTransform } from './xiaomi/stream'
import { createZhipuResponsesStreamTransform } from './zhipu/stream'

const chunk = (delta: unknown, finish_reason: string | null = null) => ({ choices: [{ delta, finish_reason }] })
for (const [provider, create] of Object.entries({ kimi: createKimiResponsesStreamTransform, qwen: createQwenResponsesStreamTransform,
  xiaomi: createXiaomiResponsesStreamTransform, zhipu: createZhipuResponsesStreamTransform })) {
  describe(`${provider} Responses stream lifecycle`, () => {
    it('never writes to closed items and preserves interleaved output order', () => {
      const transform = create()
      const events = [
        ...transform.transform(chunk({ reasoning_content: 'first' })),
        ...transform.transform(chunk({ content: 'answer' })),
        ...transform.transform(chunk({ reasoning_content: 'second' })),
        ...transform.transform(chunk({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read', arguments: '{}' } }] })),
        ...transform.transform(chunk({ content: 'last' }, 'stop')),
        ...transform.flush(),
      ] as any[]
      const closed = new Set<string>()
      for (const [index, event] of events.entries()) {
        expect(event.sequence_number).toBe(index)
        if (event.type.endsWith('.delta')) expect(closed.has(event.item_id)).toBe(false)
        if (event.type === 'response.output_item.done') closed.add(event.item.id)
      }
      expect(events.at(-1).response.output.map((item: any) => item.type)).toEqual(['reasoning', 'message', 'reasoning', 'function_call', 'message'])
      expect(events.filter(e => e.type === 'response.reasoning_summary_part.added')).toHaveLength(2)
      expect(events.filter(e => e.type === 'response.reasoning_summary_part.done')).toHaveLength(2)
      expect(new Set(events.at(-1).response.output.map((item: any) => item.id)).size).toBe(5)
      expect(transform.flush()).toEqual([])
      expect(transform.transform(chunk({ content: 'too late' }))).toEqual([])
    })
    it('keeps trailing real zero usage and does not manufacture missing usage', () => {
      const stream = create()
      stream.transform(chunk({ content: 'done' }, 'stop'))
      stream.transform({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } })
      expect((stream.flush().at(-1) as any).response.usage).toMatchObject({ input_tokens: 0, output_tokens: 0 })
      const missing = create()
      missing.transform(chunk({ content: 'done' }, 'stop'))
      expect((missing.flush().at(-1) as any).response.usage).toBeUndefined()
    })
    it.each(['length', 'content_filter'])('maps %s to incomplete', reason => {
      const stream = create()
      stream.transform(chunk({ content: 'partial' }, reason))
      expect(stream.flush().at(-1)).toMatchObject({ type: 'response.incomplete', response: { incomplete_details: {
        reason: reason === 'length' ? 'max_output_tokens' : 'content_filter',
      } } })
      expect(stream.status()).toBe('error')
    })
    it.each(['empty', 'eof', 'error', 'cancel', 'read'])('does not claim success for %s', mode => {
      const stream = create()
      if (mode !== 'empty') stream.transform(chunk({ content: 'partial' }))
      if (mode === 'error') stream.transform({ error: { code: 'denied', message: 'Denied' } })
      expect(stream.flush({ clientCanceled: mode === 'cancel', interrupted: mode === 'read' }).at(-1))
        .toMatchObject({ type: 'response.failed' })
      expect(stream.status()).toBe('error')
    })
    it('keeps one tool call when arguments interleave with text and the ID arrives late', () => {
      const stream = create()
      const events = [
        ...stream.transform(chunk({ tool_calls: [{ index: 0, function: { name: 'read', arguments: '{"a":' } }] })),
        ...stream.transform(chunk({ content: 'working' })),
        ...stream.transform(chunk({ tool_calls: [{ index: 0, id: 'late_id', function: { arguments: '1}' } }] }, 'tool_calls')),
        ...stream.flush(),
      ] as any[]
      const calls = events.at(-1).response.output.filter((x: any) => x.type === 'function_call')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({ call_id: 'late_id', arguments: '{"a":1}' })
      expect(events.filter(x => x.type === 'response.output_item.added' && x.item.type === 'function_call'))
        .toHaveLength(1)
    })
    it('keeps parallel tool arguments, including fragments before the name', () => {
      const stream = create()
      stream.transform(chunk({ tool_calls: [{ index: 0, id: 'call_a', function: { arguments: '{"a":' } }] }))
      const events = [
        ...stream.transform(chunk({ tool_calls: [{ index: 0, function: { name: 'read', arguments: '1}' } },
          { index: 1, id: 'call_b', function: { name: 'write', arguments: '{}' } }] }, 'tool_calls')),
        ...stream.flush(),
      ] as any[]
      expect(events.filter(e => e.type === 'response.function_call_arguments.delta').map(e => e.delta)).toEqual(['{"a":1}', '{}'])
      expect(events.at(-1).response.output.map((x: any) => x.call_id)).toEqual(['call_a', 'call_b'])
    })
  })
}
