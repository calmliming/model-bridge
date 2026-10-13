import { describe, expect, it } from 'vitest'
import {
  buildCcSwitchUrl,
  CC_SWITCH_TARGETS,
} from './src/ccswitch'

function paramsFromCcSwitchUrl(url: string): URLSearchParams {
  return new URLSearchParams(url.split('?')[1] || '')
}

describe('CC Switch import links', () => {
  const baseOpts = {
    origin: 'https://bridge.example.com',
    apiKey: 'mb-test',
    name: 'ModelBridge-OpenAI',
  }

  it.each(['codex', 'codex-sub2api'])('adds the current Codex model parameter for %s imports', (id) => {
    const target = CC_SWITCH_TARGETS.find((t) => t.id === id)
    expect(target).toBeDefined()

    const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(target!, baseOpts))

    expect(params.get('resource')).toBe('provider')
    expect(params.get('app')).toBe('codex')
    expect(params.get('endpoint')).toBe(baseOpts.origin)
    expect(params.get('model')).toBe('gpt-6.1-sol')
  })

  it('sets current Claude model slots without overriding the default model', () => {
    const target = CC_SWITCH_TARGETS.find((t) => t.id === 'claude')
    expect(target).toBeDefined()

    const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(target!, baseOpts))

    expect(params.get('app')).toBe('claude')
    expect(params.has('model')).toBe(false)
    expect(params.get('opusModel')).toBe('claude-opus-5-5')
    expect(params.get('sonnetModel')).toBe('claude-sonnet-5-5')
    expect(params.get('haikuModel')).toBe('claude-haiku-4-5')
  })

  it('uses current GLM, Qwen and Kimi model presets', () => {
    const glm = CC_SWITCH_TARGETS.find((t) => t.id === 'claude-zhipu')
    const qwen = CC_SWITCH_TARGETS.find((t) => t.id === 'claude-qwen')
    const kimi = CC_SWITCH_TARGETS.find((t) => t.id === 'codex-kimi')

    expect(glm?.models).toMatchObject({ model: 'glm-5.3', haikuModel: 'glm-5.3-flash' })
    expect(qwen?.models).toEqual({
      model: 'qwen3.8-max',
      sonnetModel: 'qwen3.7-plus',
      haikuModel: 'qwen3.8-flash',
      opusModel: 'qwen3.8-max',
    })
    expect(paramsFromCcSwitchUrl(buildCcSwitchUrl(qwen!, baseOpts)).get('haikuModel')).toBe('qwen3.8-flash')
    expect(paramsFromCcSwitchUrl(buildCcSwitchUrl(kimi!, baseOpts)).get('model')).toBe('kimi-k3')
  })
})
