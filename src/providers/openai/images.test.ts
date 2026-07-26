import { describe, expect, it } from 'vitest'

import {
  buildOpenAIImagesResponsesRequest,
  convertOpenAIImagesSse,
  createOpenAIImagesStreamTransform,
  createOpenAIImagesUsageParser,
  parseOpenAIImagesRequest,
  summarizeOpenAIImagesRequest,
} from './images'

function generation(overrides: Record<string, unknown> = {}) {
  return parseOpenAIImagesRequest({ prompt: 'draw a cat', ...overrides }, 'application/json', 'generations')
}

function sse(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
}

describe('OpenAI Images request parsing', () => {
  it('applies generation defaults', () => {
    expect(generation()).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'draw a cat',
      stream: false,
      n: 1,
      response_format: 'b64_json',
      images: [],
      __image_endpoint: 'generations',
    })
  })

  it('accepts valid gpt-image-2 dimensions and rejects invalid ones', () => {
    expect(generation({ size: '1024x1536' }).size).toBe('1024x1536')
    expect(() => generation({ size: '1024x1000' })).toThrow(/dimension constraints/)
    expect(() => generation({ size: '4096x1024' })).toThrow(/dimension constraints/)
  })

  it('rejects transparent output for gpt-image-2', () => {
    expect(() => generation({ background: 'transparent' })).toThrow(/does not support transparent/)
  })

  it('rejects mask file IDs that the hosted image tool cannot forward', () => {
    expect(() => parseOpenAIImagesRequest({
      prompt: 'replace the sky',
      images: [{ image_url: 'https://example.com/source.png' }],
      mask: { file_id: 'file_mask' },
    }, 'application/json', 'edits')).toThrow(/mask\.file_id is not supported/)
  })

  it('parses multipart edit uploads without exposing raw bytes in the summary', () => {
    const boundary = 'model-bridge-test-boundary'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nreplace the sky\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="source.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const parsed = parseOpenAIImagesRequest(
      body,
      `multipart/form-data; boundary=${boundary}`,
      'edits',
    )

    expect(parsed.images).toEqual([{ image_url: 'data:image/png;base64,iVBORw==' }])
    expect(summarizeOpenAIImagesRequest(parsed)).toContain('"image_inputs":1')
    expect(summarizeOpenAIImagesRequest(parsed)).not.toContain('iVBORw')
  })
})

describe('OpenAI Images Responses bridge', () => {
  it('builds the Sub2API-style image_generation tool request', () => {
    const request = parseOpenAIImagesRequest({
      model: 'gpt-image-2',
      prompt: 'replace the sky',
      images: [{ image_url: 'https://example.com/source.png' }],
      mask: { image_url: 'https://example.com/mask.png' },
      n: 2,
      size: '1024x1024',
      quality: 'high',
      output_format: 'webp',
      partial_images: 2,
    }, 'application/json', 'edits')

    expect(buildOpenAIImagesResponsesRequest(request)).toEqual({
      model: 'gpt-5.4-mini',
      instructions: '',
      input: [{
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'replace the sky' },
          { type: 'input_image', image_url: 'https://example.com/source.png' },
        ],
      }],
      tools: [{
        type: 'image_generation',
        action: 'edit',
        model: 'gpt-image-2',
        n: 2,
        size: '1024x1024',
        quality: 'high',
        output_format: 'webp',
        partial_images: 2,
        input_image_mask: { image_url: 'https://example.com/mask.png' },
      }],
      tool_choice: { type: 'image_generation' },
      stream: true,
      store: false,
    })
  })

  it('converts Responses SSE into an Images JSON response and usage', () => {
    const request = generation({ response_format: 'url' })
    const converted = convertOpenAIImagesSse(sse({
      type: 'response.completed',
      response: {
        created_at: 1_710_000_000,
        tools: [{
          type: 'image_generation',
          model: 'gpt-image-2',
          size: '1024x1024',
          quality: 'high',
          output_format: 'webp',
        }],
        tool_usage: {
          image_gen: {
            input_tokens: 46,
            output_tokens: 2459,
            output_tokens_details: { image_tokens: 2459 },
            images: 1,
          },
        },
        output: [{
          id: 'ig_1',
          type: 'image_generation_call',
          result: 'aGVsbG8=',
          revised_prompt: 'a small orange cat',
          output_format: 'webp',
        }],
      },
    }), request)

    expect(converted.body).toEqual({
      created: 1_710_000_000,
      data: [{
        url: 'data:image/webp;base64,aGVsbG8=',
        revised_prompt: 'a small orange cat',
      }],
      output_format: 'webp',
      quality: 'high',
      size: '1024x1024',
      model: 'gpt-image-2',
      usage: {
        input_tokens: 46,
        output_tokens: 2459,
        output_tokens_details: { image_tokens: 2459 },
        images: 1,
      },
    })
    expect(converted.usage).toMatchObject({
      inputTokens: 46,
      outputTokens: 0,
      imageOutputTokens: 2459,
      imageCount: 1,
      imageSize: '1024x1024',
      imageModel: 'gpt-image-2',
    })
  })

  it('falls back to response.output_item.done when completed.output is empty', () => {
    const converted = convertOpenAIImagesSse(sse(
      {
        type: 'response.output_item.done',
        item: { id: 'ig_1', type: 'image_generation_call', result: 'aGVsbG8=', output_format: 'png' },
      },
      {
        type: 'response.completed',
        response: { created_at: 123, tool_usage: { image_gen: { images: 1 } }, output: [] },
      },
    ), generation())

    expect(converted.body).toMatchObject({ created: 123, data: [{ b64_json: 'aGVsbG8=' }] })
  })

  it('maps upstream failures to an Images error response', () => {
    const converted = convertOpenAIImagesSse(sse({
      type: 'response.failed',
      response: { error: { type: 'invalid_request_error', code: 'policy_violation', message: 'blocked' } },
    }), generation())

    expect(converted.status).toBe('error')
    expect(converted.httpStatus).toBe(400)
    expect(converted.body).toEqual({
      error: { type: 'invalid_request_error', code: 'policy_violation', message: 'blocked' },
    })
  })
})

describe('OpenAI Images streaming conversion', () => {
  it('emits named partial and completed events', () => {
    const request = generation({ stream: true, response_format: 'url' })
    const transform = createOpenAIImagesStreamTransform(request)

    expect(transform.transform({
      type: 'response.image_generation_call.partial_image',
      partial_image_b64: 'cGFydGlhbA==',
      partial_image_index: 1,
      output_format: 'png',
    })).toEqual([{
      __modelBridgeSseEvent: true,
      event: 'image_generation.partial_image',
      data: expect.objectContaining({
        type: 'image_generation.partial_image',
        b64_json: 'cGFydGlhbA==',
        url: 'data:image/png;base64,cGFydGlhbA==',
        partial_image_index: 1,
      }),
    }])

    const completed = transform.transform({
      type: 'response.completed',
      response: {
        created_at: 456,
        tool_usage: { image_gen: { images: 1 } },
        tools: [{ type: 'image_generation', model: 'gpt-image-2', size: '1024x1024' }],
        output: [{ type: 'image_generation_call', result: 'ZmluYWw=', output_format: 'png' }],
      },
    })
    expect(completed).toEqual([{
      __modelBridgeSseEvent: true,
      event: 'image_generation.completed',
      data: expect.objectContaining({
        type: 'image_generation.completed',
        created_at: 456,
        b64_json: 'ZmluYWw=',
        size: '1024x1024',
        usage: { images: 1 },
      }),
    }])
    expect(transform.status()).toBe('success')
  })

  it('parses final upstream usage for billing', () => {
    const request = generation({ stream: true, size: '1024x1024' })
    const parser = createOpenAIImagesUsageParser(request)
    parser.feed({
      type: 'response.completed',
      response: {
        tool_usage: {
          image_gen: {
            input_tokens: 12,
            output_tokens: 21,
            input_tokens_details: { image_tokens: 4 },
            output_tokens_details: { image_tokens: 20 },
            images: 1,
          },
        },
        output: [{ type: 'image_generation_call', result: 'ZmluYWw=' }],
      },
    })

    expect(parser.result()).toMatchObject({
      inputTokens: 8,
      outputTokens: 1,
      imageInputTokens: 4,
      imageOutputTokens: 20,
      imageCount: 1,
      imageSize: '1024x1024',
      imageModel: 'gpt-image-2',
    })
  })
})
