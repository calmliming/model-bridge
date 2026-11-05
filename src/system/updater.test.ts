import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: { UPDATER_URL: 'http://updater:3002', UPDATE_TOKEN: 'test-token' },
  runtime: vi.fn(),
}))
vi.mock('../config', () => ({ config: mocks.config }))
vi.mock('./version', () => ({ getSystemVersionInfo: mocks.runtime }))

import { checkSystemUpdates } from './updater'

const repository = {
  currentCommit: 'a01aefc', latestCommit: 'a01aefc',
  currentVersion: '0.3.1', latestVersion: '0.3.1',
  hasUpdate: false, branch: 'main', remote: 'origin', dirty: false, checkedAt: 1,
}

beforeEach(() => {
  mocks.runtime.mockReturnValue({ version: '0.3.1', commit: null })
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(repository)))
})
afterEach(() => vi.unstubAllGlobals())

describe('running service update checks', () => {
  it('offers a rebuild when Git is current but the running service is still v0.2.2', async () => {
    mocks.runtime.mockReturnValue({ version: '0.2.2', commit: null })
    expect(await checkSystemUpdates()).toMatchObject({
      currentVersion: '0.2.2', currentCommit: null,
      repositoryVersion: '0.3.1', repositoryCommit: 'a01aefc',
      latestVersion: '0.3.1', hasUpdate: true, requiresRebuild: true, updaterAvailable: true,
    })
  })

  it('detects an old running commit even when the release version is unchanged', async () => {
    mocks.runtime.mockReturnValue({ version: '0.3.1', commit: 'b25d05e' })
    expect(await checkSystemUpdates()).toMatchObject({ hasUpdate: true, requiresRebuild: true })
  })

  it('accepts the updater short hash matching the running image full hash', async () => {
    mocks.runtime.mockReturnValue({ version: '0.3.1', commit: 'a01aefc716a7962bf5a21508389e6804911e1480' })
    expect(await checkSystemUpdates()).toMatchObject({ hasUpdate: false, requiresRebuild: false })
  })

  it('keeps source updates distinct from rebuilding an already updated checkout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...repository, currentCommit: 'b25d05e', hasUpdate: true })))
    expect(await checkSystemUpdates()).toMatchObject({ hasUpdate: true, requiresRebuild: false })
  })

  it('preserves the dirty worktree block when a rebuild is needed', async () => {
    mocks.runtime.mockReturnValue({ version: '0.2.2', commit: null })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...repository, dirty: true })))
    expect(await checkSystemUpdates()).toMatchObject({ hasUpdate: true, requiresRebuild: true, dirty: true })
  })

  it('still reports an unavailable updater without claiming a runtime comparison succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection refused') }))
    expect(await checkSystemUpdates()).toMatchObject({ updaterAvailable: false, hasUpdate: false })
  })
})
