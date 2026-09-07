import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const where = vi.fn()
  const set = vi.fn(() => ({ where }))
  return { update: vi.fn(() => ({ set })), set, where }
})
vi.mock('../db/index', () => ({ db: { update: mocks.update } }))

import { updateApiKey, type UpdateApiKeyPatch } from './manager'

beforeEach(() => vi.clearAllMocks())

describe('partial API key updates', () => {
  it.each([{ name: 'Renamed' }, { enabled: false }])('preserves model mappings for unrelated changes: %j', async (patch) => {
    await updateApiKey('key-1', { ...patch, modelMappings: undefined }, 'user-1')
    expect(mocks.set).toHaveBeenCalledWith(patch)
  })

  it.each([null, {}])('allows explicitly clearing model mappings: %j', async (modelMappings) => {
    await updateApiKey('key-1', { modelMappings })
    expect(mocks.set).toHaveBeenCalledWith({ modelMappings: null })
  })

  it('normalizes supplied mappings without mutating the caller patch', async () => {
    const patch: UpdateApiKeyPatch = { modelMappings: { ' alias ': ' gpt-5.4 ' } }
    await updateApiKey('key-1', patch)
    expect(mocks.set).toHaveBeenCalledWith({ modelMappings: { alias: 'gpt-5.4' } })
    expect(patch.modelMappings).toEqual({ ' alias ': ' gpt-5.4 ' })
  })

  it('does not issue an empty database update for undefined fields', async () => {
    await updateApiKey('key-1', { modelMappings: undefined, name: undefined })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
