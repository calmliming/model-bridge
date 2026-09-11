import { describe, expect, it } from 'vitest'
import { sanitizeGeminiBody } from './relay'

function sanitize(parameters: unknown) {
  const body = { tools: [{ functionDeclarations: [{ name: 'tool', parameters }] }] }
  return (sanitizeGeminiBody(body).tools as typeof body.tools)[0]!.functionDeclarations[0]!.parameters
}

describe('Gemini local schema references', () => {
  it('expands references and keeps nested required properties before stripping definitions', () => {
    const parameters = { type: 'object', properties: { address: { $ref: '#/$defs/address', description: 'Ship here' } },
      $defs: { address: { type: 'object', properties: { city: { type: 'string', maxLength: 100 } }, required: ['city'] } } }
    expect(sanitize(parameters)).toEqual({ type: 'object', properties: { address: {
      type: 'object', properties: { city: { type: 'string' } }, required: ['city'], description: 'Ship here',
    } } })
    expect(parameters.properties.address.$ref).toBe('#/$defs/address')
  })
  it('resolves escaped JSON Pointer names and repeated references independently', () => {
    expect(sanitize({ type: 'object', properties: { a: { $ref: '#/definitions/a~1b~0c' }, b: { $ref: '#/definitions/a~1b~0c' } },
      definitions: { 'a/b~c': { type: 'string' } } })).toEqual({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } })
  })
  it.each([
    { $ref: 'https://untrusted.example/schema' },
    { $ref: '#/$defs/missing' },
    { $ref: '#/$defs/loop', $defs: { loop: { type: 'object', properties: { next: { $ref: '#/$defs/loop' } } } } },
  ])('rejects an unsupported reference as a client error without fetching it', parameters => {
    expect(() => sanitize(parameters)).toThrowError(expect.objectContaining({ statusCode: 400, code: 'invalid_tool_schema' }))
  })
  it('does not remove signed model content', () => {
    const contents = [{ role: 'model', parts: [{ text: 'x', thoughtSignature: 'sig' }] }]
    expect(sanitizeGeminiBody({ contents }).contents).toBe(contents)
  })
})
