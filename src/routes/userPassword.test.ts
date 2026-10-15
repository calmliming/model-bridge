import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ begin: vi.fn(), accept: vi.fn() }))
vi.mock('../db/index', () => ({ db: {}, pool: {} }))
vi.mock('../db/settings', async original => ({
  ...await original<typeof import('../db/settings')>(), isRegistrationEnabled: async () => true,
}))
vi.mock('../auth/security', async original => ({
  ...await original<typeof import('../auth/security')>(), verifyTurnstileToken: async () => true,
}))
vi.mock('../users/emailRegistration', async original => ({
  ...await original<typeof import('../users/emailRegistration')>(), beginEmailRegistration: mocks.begin,
}))
vi.mock('../users/manager', async original => ({
  ...await original<typeof import('../users/manager')>(), acceptInvite: mocks.accept,
}))

import { registerAuthRoutes } from './auth'
import { registerUserRoutes } from './users'
import { resetLimits } from '../middleware/limits'

beforeEach(async () => {
  vi.clearAllMocks()
  await resetLimits()
  mocks.begin.mockResolvedValue({ expiresAt: Date.now() + 600_000, resendAfter: Date.now() + 60_000 })
  mocks.accept.mockResolvedValue({ id: 'user-1', email: 'user@example.test', name: 'User' })
})

async function submit(path: string, password: string) {
  const app = Fastify()
  await app.register(jwt, { secret: 'password-boundary-test' })
  registerAuthRoutes(app)
  registerUserRoutes(app)
  try {
    return await app.inject({ method: 'POST', url: path, payload: { email: 'user@example.test', token: 'test-invite', password } })
  } finally { await app.close() }
}

describe.each([
  ['/api/auth/register', 202],
  ['/api/users/invites/accept', 200],
] as const)('password byte limits at %s', (path, successStatus) => {
  it.each(['a'.repeat(72), '汉'.repeat(24)])('accepts exactly 72 UTF-8 bytes', async password => {
    expect((await submit(path, password)).statusCode).toBe(successStatus)
  })

  it.each(['a'.repeat(73), '汉'.repeat(24) + 'a', '汉'.repeat(25)])('rejects passwords truncated by bcrypt before persistence', async password => {
    const response = await submit(path, password)
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('72 个 UTF-8 字节')
    expect(mocks.begin).not.toHaveBeenCalled()
    expect(mocks.accept).not.toHaveBeenCalled()
  })
})
