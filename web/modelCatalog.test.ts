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
