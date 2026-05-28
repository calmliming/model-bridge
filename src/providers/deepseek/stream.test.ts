import { describe, expect, it } from 'vitest'

import { createDeepseekResponsesStreamTransform } from './stream'

interface ResponsesEvent {
  type: string
  sequence_number: number
  item_id?: string
  output_index?: number
  content_index?: number
  delta?: string
  text?: string
  arguments?: string
  response?: {
    status?: string
    model?: string
    output?: unknown[]
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      input_tokens_details?: { cached_tokens?: number }
      output_tokens_details?: { reasoning_tokens?: number }
    }
  }
  item?: { id?: string; type?: string; name?: string; call_id?: string; arguments?: string }
}

function feed(xf: ReturnType<typeof createDeepseekResponsesStreamTransform>, chunks: unknown[]): ResponsesEvent[] {
  const out: ResponsesEvent[] = []
  for (const c of chunks) out.push(...(xf.transform(c) as ResponsesEvent[]))
  out.push(...(xf.flush() as ResponsesEvent[]))
  return out
}

function types(events: ResponsesEvent[]): string[] {
  return events.map((e) => e.type)
}

function eventsOfType(events: ResponsesEvent[], type: string): ResponsesEvent[] {
  return events.filter((e) => e.type === type)
}

describe('createDeepseekResponsesStreamTransform', () => {
  it('emits created → in_progress → completed even when upstream sends nothing useful', () => {
    const xf = createDeepseekResponsesStreamTransform()
    const events = feed(xf, [])
    expect(types(events)).toEqual(['response.created', 'response.in_progress', 'response.completed'])
    expect(events[0]?.sequence_number).toBe(0)
    expect(events[2]?.response?.status).toBe('completed')
    expect(events[2]?.response?.usage).toEqual({
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    })
  })

  it('translates a typical text-only stream end-to-end', () => {
    const xf = createDeepseekResponsesStreamTransform()
    const events = feed(xf, [
      { id: 'c1', model: 'deepseek-chat', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { content: 'hel' }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { content: 'lo ' }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: { content: 'world' }, finish_reason: null }] },
      { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 4 } },
    ])

    expect(types(events)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ])

    // sequence numbers strictly increasing from 0
    for (let i = 0; i < events.length; i++) expect(events[i]?.sequence_number).toBe(i)

    const deltas = eventsOfType(events, 'response.output_text.delta')
    expect(deltas.map((e) => e.delta)).toEqual(['hel', 'lo ', 'world'])

    const itemAdded = eventsOfType(events, 'response.output_item.added')[0]
    const done = eventsOfType(events, 'response.output_text.done')[0]
    expect(done?.item_id).toBe(itemAdded?.item?.id)
    expect(done?.output_index).toBe(0)
    expect(done?.content_index).toBe(0)
    expect(done?.text).toBe('hello world')

    const completed = events[events.length - 1]!
    expect(completed.response?.status).toBe('completed')
    expect(completed.response?.usage).toEqual({
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 15,
    })
    const output = completed.response?.output ?? []
    expect(output).toHaveLength(1)
    expect((output[0] as { type: string }).type).toBe('message')
  })

  it('handles reasoner streams: reasoning closes before message opens', () => {
    const xf = createDeepseekResponsesStreamTransform()
    const events = feed(xf, [
      { id: 'r1', model: 'deepseek-reasoner', choices: [{ delta: { reasoning_content: 'think ' } }] },
      { id: 'r1', choices: [{ delta: { reasoning_content: 'about' } }] },
      { id: 'r1', choices: [{ delta: { content: 'answer' } }] },
      { id: 'r1', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } },
    ])

    expect(types(events)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added', // reasoning
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.done',
      'response.reasoning_summary_part.done',
      'response.output_item.done', // reasoning done
      'response.output_item.added', // message
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ])

    const reasoningDone = eventsOfType(events, 'response.reasoning_summary_text.done')[0]
    expect(reasoningDone?.text).toBe('think about')

    const completed = events[events.length - 1]!
    const output = (completed.response?.output ?? []) as Array<{ type: string }>
    expect(output.map((o) => o.type)).toEqual(['reasoning', 'message'])
  })

  it('streams a single tool call with arguments accumulated across chunks', () => {
    const xf = createDeepseekResponsesStreamTransform()
    const events = feed(xf, [
      { choices: [{ delta: { role: 'assistant' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_xyz', function: { name: 'lookup' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"foo"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])

    const added = eventsOfType(events, 'response.output_item.added')
    expect(added).toHaveLength(1)
    expect(added[0]?.item?.type).toBe('function_call')
    expect(added[0]?.item?.name).toBe('lookup')
    expect(added[0]?.item?.call_id).toBe('call_xyz')

    const argDeltas = eventsOfType(events, 'response.function_call_arguments.delta')
    expect(argDeltas.map((e) => e.delta)).toEqual(['{"q":', '"foo"}'])

    const argDone = eventsOfType(events, 'response.function_call_arguments.done')[0]
    expect(argDone?.arguments).toBe('{"q":"foo"}')

    const completed = events[events.length - 1]!
    const output = (completed.response?.output ?? []) as Array<{ type: string; name?: string; arguments?: string }>
    expect(output).toHaveLength(1)
    expect(output[0]?.type).toBe('function_call')
    expect(output[0]?.name).toBe('lookup')
    expect(output[0]?.arguments).toBe('{"q":"foo"}')
  })

  it('defers function_call output_item.added until the tool name arrives', () => {
    const xf = createDeepseekResponsesStreamTransform()
    const events = feed(xf, [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_late' }] } }] },
      // no name yet, no arguments yet → no added event from this chunk
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'doit', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])

    // The first tool_calls delta produces zero events; the second produces
    // added + arguments.delta together.
    const beforeFlushTypes = types(events).slice(0, types(events).indexOf('response.completed'))
    const firstAddedIdx = beforeFlushTypes.indexOf('response.output_item.added')
    const argsDeltaIdx = beforeFlushTypes.indexOf('response.function_call_arguments.delta')
    expect(firstAddedIdx).toBeGreaterThanOrEqual(0)
    expect(argsDeltaIdx).toBeGreaterThan(firstAddedIdx)

    const added = eventsOfType(events, 'response.output_item.added')[0]
    expect(added?.item?.call_id).toBe('call_late')
    expect(added?.item?.name).toBe('doit')
  })

  it('handles multiple tool calls with interleaved index buckets', () => {
    const xf = createDeepseekResponsesStreamTransform()
    const events = feed(xf, [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'aa', arguments: '{"x":1}' } },
                { index: 1, id: 'call_b', function: { name: 'bb', arguments: '{"y":' } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '2}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])

    const argsDone = eventsOfType(events, 'response.function_call_arguments.done')
    expect(argsDone.map((e) => e.arguments)).toEqual(['{"x":1}', '{"y":2}'])

    const completed = events[events.length - 1]!
    const output = (completed.response?.output ?? []) as Array<{ name?: string }>
    expect(output.map((o) => o.name)).toEqual(['aa', 'bb'])
  })

  it('produces completed with zeroed usage when upstream never sends usage', () => {
    const xf = createDeepseekResponsesStreamTransform()
    const events = feed(xf, [
      { choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] },
    ])
    const completed = events[events.length - 1]!
    expect(completed.response?.usage).toEqual({
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    })
  })

  it('keeps sequence numbers strictly increasing across all emitted events', () => {
    const xf = createDeepseekResponsesStreamTransform()
    const events = feed(xf, [
      { choices: [{ delta: { reasoning_content: 'r' } }] },
      { choices: [{ delta: { content: 'c' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'f', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ])
    for (let i = 0; i < events.length; i++) expect(events[i]?.sequence_number).toBe(i)
  })
})
