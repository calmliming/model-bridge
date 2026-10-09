import bcrypt from 'bcryptjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'initial-test-password' as string | undefined },
  settings: new Map<string, string>(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  query: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
}))

vi.mock('../config', () => ({ config: mocks.config }))
vi.mock('../db/settings', () => ({ getSetting: mocks.getSetting, setSetting: mocks.setSetting }))
vi.mock('../db/index', () => ({ pool: { connect: mocks.connect } }))

import { changeAdminPassword, ensureAdmin, verifyAdminCredentials } from './admin'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.config.ADMIN_PASSWORD = 'initial-test-password'
  mocks.settings.clear()
  mocks.settings.set('admin.user_id', 'admin-user')
  mocks.getSetting.mockImplementation(async (key: string) => mocks.settings.get(key) ?? null)
  mocks.setSetting.mockImplementation(async (key: string, value: string) => { mocks.settings.set(key, value) })
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('SELECT u.id') ? [{ id: 'admin-user', email: 'admin@model-bridge.local' }] : [],
  }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

const invalidPasswords = [undefined, '', 'admin', '1234567', ' '.repeat(8), 'a'.repeat(73), '汉'.repeat(25)]

describe('first admin creation', () => {
  it.each(invalidPasswords)('rejects an invalid initial password (%s) before writing credentials', async password => {
    mocks.config.ADMIN_PASSWORD = password
    await expect(ensureAdmin()).rejects.toThrow('ADMIN_PASSWORD')
    expect(mocks.setSetting).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it.each(['a'.repeat(8), 'a'.repeat(72), '汉'.repeat(24)])('hashes a valid password without logging it (%s)', async password => {
    mocks.config.ADMIN_PASSWORD = password
    await ensureAdmin()
    const hash = mocks.settings.get('admin.password_hash')!
    expect(hash).not.toBe(password)
    expect(bcrypt.compareSync(password, hash)).toBe(true)
    await expect(verifyAdminCredentials('admin', password)).resolves.toBe(true)
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining(password))
    expect(mocks.release).toHaveBeenCalledOnce()
  })
})

describe('existing admin upgrade', () => {
  it.each(invalidPasswords)('keeps stored credentials even if the old environment password is invalid (%s)', async password => {
    mocks.config.ADMIN_PASSWORD = password
    mocks.settings.set('admin.password_hash', 'stored-password-hash')
    mocks.settings.set('admin.username', 'existing-admin')
    await expect(ensureAdmin()).resolves.toBeUndefined()
    expect(mocks.settings.get('admin.password_hash')).toBe('stored-password-hash')
    expect(mocks.settings.get('admin.username')).toBe('existing-admin')
    expect(mocks.setSetting).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), [
      'stored-password-hash', expect.any(Number), 'admin-user',
    ])
  })
})

describe('admin password changes', () => {
  beforeEach(() => {
    mocks.settings.set('admin.password_hash', bcrypt.hashSync('admin', 4))
    mocks.settings.set('admin.username', 'admin')
  })

  it('lets an existing admin replace a legacy short password', async () => {
    await expect(changeAdminPassword('admin', 'new-valid-password')).resolves.toBe(true)
    await expect(verifyAdminCredentials('admin', 'admin')).resolves.toBe(false)
    await expect(verifyAdminCredentials('admin', 'new-valid-password')).resolves.toBe(true)
  })

  it.each(['1234567', ' '.repeat(8), 'a'.repeat(73), '汉'.repeat(25)])('rejects an invalid new password (%s) without replacing the hash', async password => {
    await expect(changeAdminPassword('admin', password)).rejects.toThrow('8–72')
    expect(mocks.setSetting).not.toHaveBeenCalled()
    await expect(verifyAdminCredentials('admin', 'admin')).resolves.toBe(true)
  })

  it('does not change credentials when the current password is incorrect', async () => {
    await expect(changeAdminPassword('incorrect', 'new-valid-password')).resolves.toBe(false)
    expect(mocks.setSetting).not.toHaveBeenCalled()
  })
})
