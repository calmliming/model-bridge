import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ changePassword: vi.fn() }))
vi.mock('../db/index', () => ({ pool: {}, db: {} }))
vi.mock('../auth/admin', () => ({
  changeAdminPassword: mocks.changePassword,
  getAdminUserId: vi.fn(), getAdminUsername: vi.fn(), verifyAdminCredentials: vi.fn(),
}))

import { registerAdminRoutes } from './admin'

let app: ReturnType<typeof Fastify>
let authorization: string
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.changePassword.mockResolvedValue(true)
  app = Fastify()
  await app.register(jwt, { secret: 'admin-password-route-test' })
  registerAdminRoutes(app)
  authorization = `Bearer ${app.jwt.sign({ role: 'admin' })}`
})
afterEach(() => app.close())

const changePassword = (newPassword: string) => app.inject({
  method: 'POST', url: '/api/admin/change-password', headers: { authorization },
  payload: { currentPassword: 'admin', newPassword },
})

describe('admin password API', () => {
  it.each(['1234567', ' '.repeat(8), 'a'.repeat(73), '汉'.repeat(25)])('rejects invalid password bytes (%s) before storage', async password => {
    const response = await changePassword(password)
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('8–72')
    expect(mocks.changePassword).not.toHaveBeenCalled()
  })

  it.each(['a'.repeat(8), 'a'.repeat(72), '汉'.repeat(24)])('accepts a valid password (%s), including a legacy current password', async password => {
    const response = await changePassword(password)
    expect(response.statusCode).toBe(200)
    expect(mocks.changePassword).toHaveBeenCalledWith('admin', password)
  })

  it('rejects an incorrect current password', async () => {
    mocks.changePassword.mockResolvedValue(false)
    const response = await changePassword('new-valid-password')
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('current password is incorrect')
  })
})
