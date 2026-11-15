import { Readable } from 'node:stream'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerResponsesUtf8Validation } from './utf8'
import { ingressMemoryBytes, registerIngressMemory } from './ingressMemory'

async function fixture(run: (app: ReturnType<typeof Fastify>) => Promise<void>, bodyLimit = 1024) {
  const app = Fastify({ bodyLimit })
  registerIngressMemory(app)
  registerResponsesUtf8Validation(app)
  app.post('/v1/responses', async request => request.body)
  app.post('/api/openai/v1/responses/input_tokens', async request => request.body)
  app.post('/upload', async request => request.body)
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))
  try { await run(app) } finally { await app.close() }
  expect(ingressMemoryBytes()).toBe(0)
}

describe('Responses UTF-8 validation before JSON parsing', () => {
  it('preserves Unicode split at every byte, JSON errors and the configured body limit', () => fixture(async app => {
    const payload = { input: '中文 🌉 \ufffd', model: 'gpt-6.1-sol' }
    const bytes = Buffer.from(JSON.stringify(payload))
    const response = await app.inject({ method: 'POST', url: '/v1/responses', headers: {
      'content-type': 'application/json; charset=utf-8', 'content-length': String(bytes.length),
    }, payload: Readable.from([...bytes].map(byte => Buffer.from([byte]))) })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(payload)
    expect((await app.inject({ method: 'POST', url: '/v1/responses', headers: { 'content-type': 'application/json' }, payload: '{' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/v1/responses', payload: { input: 'x'.repeat(2048) } })).statusCode).toBe(413)
  }))

  it.each(['/v1/responses', '/api/openai/v1/responses/input_tokens'])('rejects a truncated final sequence and releases upload memory on %s', url => fixture(async app => {
    const response = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' },
      payload: Readable.from([Buffer.from('{"input":"'), Buffer.from([0xe4]), Buffer.from([0xb8])]) })
    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('invalid_request_error')
    expect(ingressMemoryBytes()).toBe(0)
  }))

  it('does not reinterpret binary uploads', () => fixture(async app => {
    const payload = Buffer.from([0xff, 0xc3, 0x28])
    const response = await app.inject({ method: 'POST', url: '/upload', headers: { 'content-type': 'application/octet-stream' }, payload })
    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toEqual(payload)
  }))
})
