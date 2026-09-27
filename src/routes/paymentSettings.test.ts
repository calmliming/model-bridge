import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: new Map<string, string>(), read: vi.fn(), write: vi.fn(),
}))

vi.mock('../db/index', () => ({
  pool: {},
  db: {
    select: () => ({ from: () => ({ where: mocks.read }) }),
    insert: () => ({ values: (row: { key: string; value: string }) => ({
      onConflictDoUpdate: () => mocks.write(row),
    }) }),
  },
}))

import { registerAdminRoutes } from './admin'

const SETTING_KEY = 'online_payments_enabled'

beforeEach(() => {
  mocks.settings.clear()
  mocks.read.mockReset().mockImplementation(async (condition: SQL) => {
    const key = new PgDialect().sqlToQuery(condition).params[0] as string
    const value = mocks.settings.get(key)
    return value === undefined ? [] : [{ key, value }]
  })
  mocks.write.mockReset().mockImplementation(async ({ key, value }: { key: string; value: string }) => {
    mocks.settings.set(key, value)
  })
})

async function withApp(run: (app: ReturnType<typeof Fastify>, headers: { authorization: string }) => Promise<void>) {
  const app = Fastify()
  await app.register(fastifyJwt, { secret: 'payment-settings-test-secret' })
  registerAdminRoutes(app)
  const headers = { authorization: `Bearer ${app.jwt.sign({ sub: 'admin', role: 'admin' })}` }
  try { await run(app, headers) } finally { await app.close() }
}

describe('admin online payment settings', () => {
  it('preserves existing payment availability when the setting has not been stored', () => withApp(async (app, headers) => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/settings', headers })
    expect(response.statusCode).toBe(200)
    expect(response.json().onlinePaymentsEnabled).toBe(true)
    expect(mocks.write).not.toHaveBeenCalled()
  }))

  it('persists disabling across app instances and can re-enable without a restart', async () => {
    await withApp(async (app, headers) => {
      const response = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: { onlinePaymentsEnabled: false } })
      expect(response.statusCode).toBe(200)
      expect(response.json().onlinePaymentsEnabled).toBe(false)
      expect(mocks.settings.get(SETTING_KEY)).toBe('false')
    })
    await withApp(async (app, headers) => {
      const stored = await app.inject({ method: 'GET', url: '/api/admin/settings', headers })
      expect(stored.json().onlinePaymentsEnabled).toBe(false)
      const enabled = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: { onlinePaymentsEnabled: true } })
      expect(enabled.statusCode).toBe(200)
      expect(enabled.json().onlinePaymentsEnabled).toBe(true)
      expect(mocks.settings.get(SETTING_KEY)).toBe('true')
    })
  })

  it('does not change the payment switch when updating an unrelated setting', () => withApp(async (app, headers) => {
    mocks.settings.set(SETTING_KEY, 'false')
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: { quotaAutopausePercent: 80 } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ onlinePaymentsEnabled: false, quotaAutopausePercent: 80 })
    expect(mocks.settings.get(SETTING_KEY)).toBe('false')
  }))

  it('rejects non-boolean input without modifying the setting', () => withApp(async (app, headers) => {
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: { onlinePaymentsEnabled: 'false' } })
    expect(response.statusCode).toBe(400)
    expect(mocks.write).not.toHaveBeenCalled()
  }))

  it('requires an administrator to read or change payment settings', () => withApp(async app => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/settings' })
    expect(anonymous.statusCode).toBe(401)
    const userHeaders = { authorization: `Bearer ${app.jwt.sign({ sub: 'user_1', role: 'user' })}` }
    for (const method of ['GET', 'PATCH'] as const) {
      const response = await app.inject({ method, url: '/api/admin/settings', headers: userHeaders,
        ...(method === 'PATCH' ? { payload: { onlinePaymentsEnabled: false } } : {}),
      })
      expect(response.statusCode).toBe(403)
    }
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  }))

  it('does not claim success or change the value when persistence fails', () => withApp(async (app, headers) => {
    mocks.write.mockRejectedValueOnce(new Error('database unavailable'))
    const response = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: { onlinePaymentsEnabled: false } })
    expect(response.statusCode).toBe(500)
    expect(mocks.settings.has(SETTING_KEY)).toBe(false)
    const stored = await app.inject({ method: 'GET', url: '/api/admin/settings', headers })
    expect(stored.json().onlinePaymentsEnabled).toBe(true)
  }))
})
