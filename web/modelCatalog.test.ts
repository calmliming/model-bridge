import { describe, expect, it } from 'vitest'
import { MODEL_CATALOG, resolveModelPrice } from './src/catalog/modelCatalog'

function model(id: string) {
  const found = MODEL_CATALOG.find((item) => item.id === id)
  if (!found) throw new Error(`missing model fixture: ${id}`)
  return found
}

describe('DeepSeek catalog pricing schedule', () => {
  it('exposes V4.1 Flash as multimodal and retires the old Flash cards', () => {
    expect(model('deepseek-flash')).toMatchObject({
      name: 'DeepSeek V4.1 Flash',
      provider: 'deepseek',
      context: '1M',
      categories: expect.arrayContaining(['multimodal']),
    })
    expect(MODEL_CATALOG.some((item) => ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'].includes(item.id))).toBe(false)
  })

  it('shows the previous price before the schedule takes effect', () => {
    expect(resolveModelPrice(
      model('deepseek-v4-pro'),
      Date.parse('2026-08-22T15:59:59.999Z'),
    )).toMatchObject({
      inputPrice: 0.435,
      outputPrice: 0.87,
      cacheReadPrice: 0.003625,
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
      model('deepseek-flash'),
      Date.parse('2026-09-12T02:00:00Z'),
    )).toMatchObject({
      inputPrice: 0.15,
      outputPrice: 0.6,
      cacheReadPrice: 0.003,
      period: 'off-peak',
    })
  })

  it('shows new Flash peak rates and switches Pro at the announced retirement time', () => {
    expect(resolveModelPrice(model('deepseek-flash'), Date.parse('2026-09-10T14:00:00+08:00')))
      .toMatchObject({ inputPrice: 0.3, outputPrice: 1.2, cacheReadPrice: 0.006, period: 'peak' })
    const retire = Date.parse('2026-09-14T12:00:00+08:00')
    expect(resolveModelPrice(model('deepseek-v4-pro'), retire - 1))
      .toMatchObject({ inputPrice: 1.32, outputPrice: 3.96, period: 'peak' })
    expect(resolveModelPrice(model('deepseek-v4-pro'), retire))
      .toMatchObject({ inputPrice: 0.15, outputPrice: 0.6, cacheReadPrice: 0.003, period: 'off-peak' })
    expect(resolveModelPrice(model('deepseek-v4-pro'), retire + 2 * 60 * 60_000))
      .toMatchObject({ inputPrice: 0.3, outputPrice: 1.2, cacheReadPrice: 0.006, period: 'peak' })
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
  it('exposes Astra with verified base prices and image input capability', () => {
    expect(model('gpt-6-astra')).toMatchObject({ context: '1.05M', inputPrice: 10, outputPrice: 50,
      cacheReadPrice: 1, categories: expect.arrayContaining(['multimodal']) })
  })
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
