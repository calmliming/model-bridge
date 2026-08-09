import { describe, expect, it } from 'vitest'

import { normalizeOpenaiResponsesBody } from './relay'

describe('normalizeOpenaiResponsesBody', () => {
  it('converts string input and applies Codex-required defaults', () => {
    const body = normalizeOpenaiResponsesBody({
      model: 'gpt-5.4',
      input: 'hello',
      max_output_tokens: 100,
      parallel_tool_calls: true,
    })

    expect(body).toMatchObject({
      model: 'gpt-5.4',
      stream: true,
      store: false,
      instructions: 'You are Codex, a helpful AI coding assistant.',
    })
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }])
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body).not.toHaveProperty('parallel_tool_calls')
  })

  it('strips explicit image_generation tools and image tool_choice', () => {
    const body = normalizeOpenaiResponsesBody({
      model: 'gpt-5.4',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'draw' }] }],
      tools: [
        { type: 'function', name: 'shell', parameters: { type: 'object' } },
        { type: 'image_generation', format: 'jpeg' },
      ],
      tool_choice: { type: 'image_generation' },
    })

    expect(body.tools).toEqual([{ type: 'function', name: 'shell', parameters: { type: 'object' } }])
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('removes the tools key when only image_generation was present', () => {
    const body = normalizeOpenaiResponsesBody({
      model: 'gpt-5.4',
      input: 'draw',
      tools: [{ type: 'image_generation' }],
      tool_choice: { type: 'function', function: { name: 'image_generation' } },
    })

    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('preserves explicit image_generation tools when enabled', () => {
    const body = normalizeOpenaiResponsesBody({
      model: 'gpt-5.4',
      input: 'draw',
      tools: [{ type: 'image_generation', model: 'gpt-image-2' }],
      tool_choice: { type: 'image_generation' },
    }, { allowImageGeneration: true })

    expect(body.tools).toEqual([{ type: 'image_generation', model: 'gpt-image-2' }])
    expect(body.tool_choice).toEqual({ type: 'image_generation' })
  })

  it('normalizes null function parameters in native Responses tools', () => {
    const body = normalizeOpenaiResponsesBody({
      model: 'gpt-5.5',
      input: 'hello',
      tools: [{ type: 'function', name: 'lookup', parameters: null }],
    })

    expect(body.tools).toEqual([
      { type: 'function', name: 'lookup', parameters: { type: 'object', properties: {} } },
    ])
  })
})
