import { describe, expect, it } from 'vitest'
import { mapRequestedModel, normalizeModelMappings } from './modelMapping'

describe('normalizeModelMappings', () => {
  it('trims entries and drops invalid values', () => {
    expect(normalizeModelMappings({ ' gpt-public ': ' gpt-5.4 ', empty: '', bad: 123 })).toEqual({
      'gpt-public': 'gpt-5.4',
    })
  })

  it('returns null for empty mappings', () => {
    expect(normalizeModelMappings({ empty: ' ' })).toBeNull()
    expect(normalizeModelMappings(null)).toBeNull()
  })
})

describe('mapRequestedModel', () => {
  it('maps exact model names case-insensitively', () => {
    expect(mapRequestedModel('GPT-PUBLIC', { 'gpt-public': 'gpt-5.4' })).toBe('gpt-5.4')
  })

  it('maps wildcard sources to fixed upstream models', () => {
    expect(mapRequestedModel('gpt-4o-mini', { 'gpt-4*': 'gpt-5.4-mini' })).toBe('gpt-5.4-mini')
  })

  it('leaves unmapped models unchanged', () => {
    expect(mapRequestedModel('claude-sonnet-4-5', { 'gpt-*': 'gpt-5.4' })).toBe('claude-sonnet-4-5')
  })
})
