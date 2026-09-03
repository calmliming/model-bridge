import { describe, expect, it } from 'vitest'
import { MODEL_CATALOG, resolveModelPrice } from './src/catalog/modelCatalog'

function model(id: string) {
  const found = MODEL_CATALOG.find((item) => item.id === id)
  if (!found) throw new Error(`missing model fixture: ${id}`)
  return found
}

describe('DeepSeek catalog pricing schedule', () => {
  it('exposes the official DeepSeek vision model as multimodal', () => {
    expect(model('deepseek-v4-flash-vision-exp')).toMatchObject({
      provider: 'deepseek',
      categories: expect.arrayContaining(['multimodal']),
    })
  })

  it('shows the previous price before the schedule takes effect', () => {
    expect(resolveModelPrice(
      model('deepseek-v4-flash'),
      Date.parse('2026-08-22T15:59:59.999Z'),
    )).toMatchObject({
      inputPrice: 0.14,
      outputPrice: 0.28,
      cacheReadPrice: 0.0028,
      period: null,
    })
  })

  it('shows current off-peak and peak prices using UTC windows', () => {
    expect(resolveModelPrice(
      model('deepseek-v4-pro'),
      Date.parse('2026-08-22T16:00:00Z'),
    )).toMatchObject({
      inputPrice: 0.66,
      outputPrice: 1.98,
      cacheReadPrice: 0.022,
      period: 'off-peak',
    })
    expect(resolveModelPrice(
      model('deepseek-v4-pro'),
      Date.parse('2026-08-24T06:00:00Z'),
    )).toMatchObject({
      inputPrice: 1.32,
      outputPrice: 3.96,
      cacheReadPrice: 0.044,
      period: 'peak',
    })
  })

  it('shows Beijing weekends as off-peak even during UTC peak hours', () => {
    expect(resolveModelPrice(
      model('deepseek-v4-flash'),
      Date.parse('2026-08-29T02:00:00Z'),
    )).toMatchObject({
      inputPrice: 0.22,
      outputPrice: 0.66,
      cacheReadPrice: 0.007,
      period: 'off-peak',
    })
  })
})

describe('Codex Spark catalog', () => {
  it('uses the dedicated Spark price card', () => {
    expect(model('gpt-5.3-codex-spark')).toMatchObject({
      provider: 'openai',
      inputPrice: 1.75,
      outputPrice: 14,
      cacheReadPrice: 0.175,
    })
  })
})

describe('current provider model catalog', () => {
  it('shows the current Google and Qwen model families', () => {
    expect(model('gemini-3.8-flash')).toMatchObject({
      context: '1M',
      inputPrice: 0.75,
      outputPrice: 3.75,
      cacheReadPrice: 0.075,
      badge: 'recommended',
    })
    expect(model('gemini-3.6-flash')).toMatchObject({ context: '1M' })
    expect(model('gemini-3.1-pro-preview')).toMatchObject({ context: '1M' })
    expect(model('qwen3.8-max')).toMatchObject({ context: '1M', badge: 'recommended' })
    expect(model('qwen3.7-flash')).toMatchObject({ context: '1M' })
  })

  it('shows Claude Fable 5.1 with its reduced cache-read price', () => {
    expect(model('claude-fable-5-1')).toMatchObject({
      context: '1M',
      inputPrice: 10,
      outputPrice: 50,
      cacheReadPrice: 0.25,
      badge: 'new',
    })
    expect(model('claude-sonnet-5')).toMatchObject({ inputPrice: 2, outputPrice: 10 })
  })

  it('switches Gemini frontier Flash cards to standard pricing in 2027', () => {
    expect(resolveModelPrice(
      model('gemini-3.8-flash'),
      Date.parse('2027-01-01T00:00:00Z'),
    )).toMatchObject({ inputPrice: 1.5, outputPrice: 7.5, cacheReadPrice: 0.15 })
    expect(resolveModelPrice(
      model('gemini-3.6-flash'),
      Date.parse('2026-12-31T23:59:59.999Z'),
    )).toMatchObject({ inputPrice: 0.75, outputPrice: 3.75, cacheReadPrice: 0.075 })
  })

  it('shows current Xiaomi and GLM capabilities and context lengths', () => {
    expect(model('mimo-v2.5-pro')).toMatchObject({ context: '1M', inputPrice: 0.435, outputPrice: 0.87 })
    expect(model('mimo-v2.5')).toMatchObject({
      context: '1M',
      categories: expect.arrayContaining(['multimodal']),
    })
    expect(model('glm-5.3')).toMatchObject({ context: '1M', badge: 'recommended' })
    expect(model('glm-5.3-flash')).toMatchObject({
      context: '1M',
      categories: expect.arrayContaining(['multimodal']),
    })
  })

  it('does not advertise retired aliases, restricted models, or shut-down previews', () => {
    expect(MODEL_CATALOG.some((item) => item.id === 'deepseek-reasoner')).toBe(false)
    expect(MODEL_CATALOG.some((item) => item.id === 'claude-mythos-5-1')).toBe(false)
    expect(MODEL_CATALOG.some((item) => item.id === 'gemini-3-pro-preview')).toBe(false)
    expect(MODEL_CATALOG.some((item) => item.id === 'qwen3.8-flash')).toBe(false)
  })
})
