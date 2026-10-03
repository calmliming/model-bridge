import { describe, expect, it } from 'vitest'
import { internalKeyProviders, publicKeyProviders, publicMediaError, publicModelProvider } from './publicIdentity'

describe('public media identity', () => {
  it('keeps concrete upstream scopes private without changing their permissions', () => {
    const internal = ['grsai', 'openai']
    expect(publicKeyProviders(internal)).toEqual(['media', 'openai'])
    expect(internalKeyProviders(publicKeyProviders(internal))).toEqual(internal)
    expect(publicKeyProviders(null)).toBeNull()
    expect(internalKeyProviders(undefined)).toBeUndefined()
    expect(internalKeyProviders(['media'])).toEqual(['grsai'])
  })
  it('groups both image and video models under the platform identity', () => {
    expect(publicModelProvider('grsai', 'gpt-image-2.5')).toBe('modelbridge')
    expect(publicModelProvider('grsai', 'minimax-h3')).toBe('modelbridge')
    expect(publicModelProvider('openai', 'gpt-6.1-sol')).toBe('openai')
  })
  it('removes the channel name and credentials from error details', () => {
    const message = publicMediaError('GrsAI failed at https://grsaiapi.com Bearer sk-abcdefghijkl')
    expect(message).not.toMatch(/grsai|sk-abcdefghijkl|https:/i)
    expect(publicMediaError('duration must be at most 10 seconds')).toBe('duration must be at most 10 seconds')
  })
})
