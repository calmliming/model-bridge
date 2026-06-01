import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'

const mocks = vi.hoisted(() => {
  const where = vi.fn()
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))
  return {
    findApiKeyBySecret: vi.fn(),
    db: { update },
    update,
    set,
    where,
  }
})

vi.mock('../keys/manager', () => ({
  findApiKeyBySecret: mocks.findApiKeyBySecret,
}))

vi.mock('../db/index', () => ({
  db: mocks.db,
}))

import { requireApiKey } from './apiKeyAuth'

function fakeReply() {
  const reply = {
    statusCode: 200,
    payload: null as unknown,
    code(code: number) {
      reply.statusCode = code
      return reply
    },
    send(payload: unknown) {
      reply.payload = payload
      return reply
    },
  }
  return reply as unknown as FastifyReply & { statusCode: number; payload: unknown }
}

function fakeRequest(secret = 'mb-test') {
  return {
    headers: { authorization: `Bearer ${secret}` },
    query: {},
  } as FastifyRequest
}

function apiKeyRecord(patch: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    name: 'Key',
    enabled: true,
    allowedProviders: null,
    allowedModels: null,
    modelMappings: null,
    rateLimit: null,
    concurrencyLimit: null,
    quotaLimit: null,
    quotaUsed: 0,
    expiresAt: null,
    userId: null,
    userStatus: null,
    userBalanceMicros: null,
    ...patch,
  }
}

beforeEach(() => {
  mocks.findApiKeyBySecret.mockReset()
  mocks.update.mockClear()
  mocks.set.mockClear()
  mocks.where.mockClear()
})

describe('requireApiKey', () => {
  it('allows legacy keys without a user wallet', async () => {
    const request = fakeRequest()
    const reply = fakeReply()
    mocks.findApiKeyBySecret.mockResolvedValue(apiKeyRecord())

    await requireApiKey(request, reply)

    expect(reply.statusCode).toBe(200)
    expect(request.apiKey?.userId).toBeNull()
    expect(mocks.update).toHaveBeenCalled()
  })

  it('rejects disabled wallet users', async () => {
    const request = fakeRequest()
    const reply = fakeReply()
    mocks.findApiKeyBySecret.mockResolvedValue(apiKeyRecord({
      userId: 'user-1',
      userStatus: 'disabled',
      userBalanceMicros: 1_000_000,
    }))

    await requireApiKey(request, reply)

    expect(reply.statusCode).toBe(401)
    expect(reply.payload).toEqual({ error: 'API key owner is disabled' })
  })

  it('rejects wallet users with no positive balance', async () => {
    const request = fakeRequest()
    const reply = fakeReply()
    mocks.findApiKeyBySecret.mockResolvedValue(apiKeyRecord({
      userId: 'user-1',
      userStatus: 'active',
      userBalanceMicros: 0,
    }))

    await requireApiKey(request, reply)

    expect(reply.statusCode).toBe(402)
    expect(reply.payload).toEqual({ error: 'insufficient balance' })
  })

  it('attaches wallet metadata for active paying users', async () => {
    const request = fakeRequest()
    const reply = fakeReply()
    mocks.findApiKeyBySecret.mockResolvedValue(apiKeyRecord({
      userId: 'user-1',
      userStatus: 'active',
      userBalanceMicros: 2_500_000,
    }))

    await requireApiKey(request, reply)

    expect(reply.statusCode).toBe(200)
    expect(request.apiKey?.userId).toBe('user-1')
    expect(request.apiKey?.userBalance).toBe(2.5)
  })
})
