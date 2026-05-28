import { describe, expect, it } from 'vitest'

import { mapModel, responsesToChatCompletions } from './converter'

describe('mapModel', () => {
  it('rewrites non-deepseek model names to deepseek-v4-pro', () => {
    expect(mapModel('gpt-5-codex')).toBe('deepseek-v4-pro')
    expect(mapModel('gpt-4o')).toBe('deepseek-v4-pro')
    expect(mapModel('o3-mini')).toBe('deepseek-v4-pro')
  })

  it('passes through any deepseek-prefixed model name', () => {
    expect(mapModel('deepseek-v4-pro')).toBe('deepseek-v4-pro')
    expect(mapModel('deepseek-reasoner')).toBe('deepseek-reasoner')
    expect(mapModel('deepseek-anything-else')).toBe('deepseek-anything-else')
  })

  it('falls back to deepseek-v4-pro for empty / non-string input', () => {
    expect(mapModel('')).toBe('deepseek-v4-pro')
    expect(mapModel(undefined)).toBe('deepseek-v4-pro')
    expect(mapModel(123)).toBe('deepseek-v4-pro')
  })
})

describe('responsesToChatCompletions', () => {
  it('converts string input to a single user message', () => {
    const out = responsesToChatCompletions({ model: 'gpt-5-codex', input: 'hi', stream: true })
    expect(out.model).toBe('deepseek-v4-pro')
    expect(out.stream).toBe(true)
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('injects instructions as a leading system message', () => {
    const out = responsesToChatCompletions({
      model: 'gpt-5-codex',
      instructions: 'be brief',
      input: 'hi',
    })
    expect(out.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('preserves array input order across roles and maps developer to system', () => {
    const out = responsesToChatCompletions({
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: 'dev note' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'q1' }] },
        { role: 'assistant', content: [{ type: 'output_text', text: 'a1' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'q2' }] },
      ],
    })
    expect(out.messages).toEqual([
      { role: 'system', content: 'dev note' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ])
  })

  it('converts function_call and function_call_output items round-trip', () => {
    const out = responsesToChatCompletions({
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'list files' }] },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'list_files',
          arguments: '{"path":"."}',
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'a.ts\nb.ts' },
      ],
    })
    expect(out.messages).toEqual([
      { role: 'user', content: 'list files' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'list_files', arguments: '{"path":"."}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'a.ts\nb.ts' },
    ])
  })

  it('accepts tools in both Responses and Chat Completions shapes', () => {
    const out = responsesToChatCompletions({
      input: 'hi',
      tools: [
        {
          type: 'function',
          name: 'a',
          description: 'd1',
          parameters: { type: 'object' },
        },
        {
          type: 'function',
          function: { name: 'b', description: 'd2', parameters: { type: 'object' } },
        },
      ],
    })
    expect(out.tools).toEqual([
      { type: 'function', function: { name: 'a', description: 'd1', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'b', description: 'd2', parameters: { type: 'object' } } },
    ])
  })

  it('drops Responses-only top-level fields', () => {
    const out = responsesToChatCompletions({
      model: 'gpt-5-codex',
      input: 'hi',
      store: false,
      parallel_tool_calls: true,
      previous_response_id: 'resp_x',
      reasoning: { effort: 'high' },
      truncation: 'auto',
      metadata: { foo: 'bar' },
      service_tier: 'auto',
      background: true,
      modalities: ['text'],
      text: { format: { type: 'text' } },
      include: ['file_search_call.results'],
    }) as unknown as Record<string, unknown>
    for (const k of [
      'store',
      'parallel_tool_calls',
      'previous_response_id',
      'reasoning',
      'truncation',
      'metadata',
      'service_tier',
      'background',
      'modalities',
      'text',
      'include',
      'input',
      'instructions',
    ]) {
      expect(out).not.toHaveProperty(k)
    }
  })

  it('maps max_output_tokens to max_tokens', () => {
    const out = responsesToChatCompletions({ input: 'hi', max_output_tokens: 512 })
    expect(out.max_tokens).toBe(512)
  })

  it('preserves passthrough sampling fields', () => {
    const out = responsesToChatCompletions({
      input: 'hi',
      temperature: 0.5,
      top_p: 0.9,
      tool_choice: 'auto',
    })
    expect(out.temperature).toBe(0.5)
    expect(out.top_p).toBe(0.9)
    expect(out.tool_choice).toBe('auto')
  })

  it('returns stream:false when client did not request streaming', () => {
    const out = responsesToChatCompletions({ input: 'hi' })
    expect(out.stream).toBe(false)
  })

  it('attaches reasoning summary to the next assistant message', () => {
    const out = responsesToChatCompletions({
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'q' }] },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'think...' }] },
        { role: 'assistant', content: [{ type: 'output_text', text: 'a' }] },
      ],
    })
    expect(out.messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', reasoning_content: 'think...' },
    ])
  })

  it('attaches reasoning summary to a function_call assistant message', () => {
    const out = responsesToChatCompletions({
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'q' }] },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan' }] },
        { type: 'function_call', call_id: 'c1', name: 'ls', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c1', output: 'ok' },
      ],
    })
    expect(out.messages).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'plan',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'ls', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ])
  })

  it('merges consecutive function_calls into one assistant message so tool replies follow as a block', () => {
    const out = responsesToChatCompletions({
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'q' }] },
        { type: 'function_call', call_id: 'a', name: 'fa', arguments: '{}' },
        { type: 'function_call', call_id: 'b', name: 'fb', arguments: '{}' },
        { type: 'function_call_output', call_id: 'a', output: 'ra' },
        { type: 'function_call_output', call_id: 'b', output: 'rb' },
      ],
    })
    expect(out.messages).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'fa', arguments: '{}' } },
          { id: 'b', type: 'function', function: { name: 'fb', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: 'ra' },
      { role: 'tool', tool_call_id: 'b', content: 'rb' },
    ])
  })

  it('drops pending reasoning when no assistant message follows it', () => {
    const out = responsesToChatCompletions({
      input: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'orphan' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'q' }] },
      ],
    })
    expect(out.messages).toEqual([{ role: 'user', content: 'q' }])
  })
})
