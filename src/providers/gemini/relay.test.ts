import { describe, expect, it } from 'vitest'
import { sanitizeGeminiBody } from './relay'

describe('sanitizeGeminiBody', () => {
  it('strips unsupported JSON Schema fields from function declaration parameters', () => {
    const body = {
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'Look up weather',
              parameters: {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                $id: 'weather',
                additionalProperties: false,
                title: 'WeatherArgs',
                type: 'object',
                properties: {
                  city: { type: 'string', description: 'City name', default: 'NYC', examples: ['LA'] },
                  unit: { type: 'string', enum: ['c', 'f'], nullable: true },
                },
                required: ['city'],
              },
            },
          ],
        },
      ],
    }
    const cleaned = sanitizeGeminiBody(body)
    const params = (cleaned.tools as any)[0].functionDeclarations[0].parameters
    expect(params).toEqual({
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
        unit: { type: 'string', enum: ['c', 'f'] },
      },
      required: ['city'],
    })
  })

  it('recurses into nested objects and array items', () => {
    const body = {
      tools: [
        {
          functionDeclarations: [
            {
              name: 'nested',
              parameters: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  filters: {
                    type: 'array',
                    title: 'Filters',
                    items: {
                      type: 'object',
                      $defs: {},
                      properties: {
                        field: { type: 'string', default: 'x' },
                        ranges: {
                          type: 'array',
                          items: { type: 'number', nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    }
    const params = (sanitizeGeminiBody(body).tools as any)[0].functionDeclarations[0].parameters
    expect(params).toEqual({
      type: 'object',
      properties: {
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              ranges: { type: 'array', items: { type: 'number' } },
            },
          },
        },
      },
    })
  })

  it('cleans schemas inside anyOf/oneOf branches', () => {
    const body = {
      tools: [
        {
          functionDeclarations: [
            {
              name: 'union',
              parameters: {
                type: 'object',
                properties: {
                  value: {
                    anyOf: [
                      { type: 'string', title: 'asString' },
                      { type: 'number', default: 0 },
                    ],
                  },
                },
              },
            },
          ],
        },
      ],
    }
    const params = (sanitizeGeminiBody(body).tools as any)[0].functionDeclarations[0].parameters
    expect(params.properties.value.anyOf).toEqual([{ type: 'string' }, { type: 'number' }])
  })

  it('returns the body unchanged when there are no tools', () => {
    const body = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }
    expect(sanitizeGeminiBody(body)).toBe(body)
  })

  it('does not mutate the original body', () => {
    const params = { type: 'object', additionalProperties: false, properties: {} }
    const body = { tools: [{ functionDeclarations: [{ name: 'f', parameters: params }] }] }
    sanitizeGeminiBody(body)
    expect(params.additionalProperties).toBe(false) // original untouched
  })

  it('leaves tools without functionDeclarations alone', () => {
    const body = { tools: [{ googleSearch: {} }] }
    expect(sanitizeGeminiBody(body)).toEqual({ tools: [{ googleSearch: {} }] })
  })
})
