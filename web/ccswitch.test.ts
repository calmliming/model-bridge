import { describe, expect, it } from 'vitest'
import {
  buildCcSwitchUrl,
  CC_SWITCH_TARGETS,
  OPENAI_CC_SWITCH_CODEX_MODEL,
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

  it('adds the Codex model parameter for OpenAI imports', () => {
    const target = CC_SWITCH_TARGETS.find((t) => t.id === 'codex')
    expect(target).toBeDefined()

    const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(target!, baseOpts))

    expect(params.get('resource')).toBe('provider')
    expect(params.get('app')).toBe('codex')
    expect(params.get('endpoint')).toBe(baseOpts.origin)
    expect(params.get('model')).toBe(OPENAI_CC_SWITCH_CODEX_MODEL)
  })

  it('does not add a model parameter for Claude imports', () => {
    const target = CC_SWITCH_TARGETS.find((t) => t.id === 'claude')
    expect(target).toBeDefined()

    const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(target!, baseOpts))

    expect(params.get('app')).toBe('claude')
    expect(params.has('model')).toBe(false)
  })
})
