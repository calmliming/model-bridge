import { describe, expect, it } from 'vitest'
import {
  buildCcSwitchUrl,
  CC_SWITCH_TARGETS,
  ccSwitchTarget,
  targetsForProviders,
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
    expect(params.get('endpoint')).toBe(`${baseOpts.origin}/api/${target!.provider}/v1`)
    expect(params.get('model')).toBe('gpt-6.1-sol')
    const { config } = JSON.parse(atob(params.get('config')!))
    expect(config).toContain('model = "gpt-6.1-sol"')
    expect(config).toContain(`base_url = "${params.get('endpoint')}"`)
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('requires_openai_auth = false')
    expect(config).toContain('supports_websockets = false')
    expect(config).toContain('web_search = "live"')
    expect(config).not.toContain(baseOpts.apiKey)
  })

  it('includes the Codex image extension only for enabled native OpenAI routes', () => {
    const getConfig = (id: string, enabled: boolean) => {
      const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(ccSwitchTarget(id)!, {
        ...baseOpts, openaiImageGenerationEnabled: enabled,
      }))
      return JSON.parse(atob(params.get('config')!)).config
    }
    expect(getConfig('codex', true)).toContain('"x-openai-actor-authorization" = "local-image-extension"')
    expect(getConfig('codex', false)).not.toContain('local-image-extension')
    expect(getConfig('codex-sub2api', true)).not.toContain('local-image-extension')
  })

  it('uses the configured public gateway for both inference and balance', () => {
    const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(ccSwitchTarget('grokbuild')!, {
      ...baseOpts, ccSwitchApiBaseUrl: 'https://api.example.com/relay/',
    }))
    expect(params.get('homepage')).toBe(baseOpts.origin)
    expect(params.get('endpoint')).toBe('https://api.example.com/relay/api/grok/v1')
    expect(params.get('usageBaseUrl')).toBe('https://api.example.com/relay')
    expect(params.get('app')).toBe('grokbuild')
    expect(params.get('model')).toBe('grok-4.5')
  })

  it('intersects the group provider pool with key permissions before choosing import clients', () => {
    const ids = (allowed?: string[] | null, group?: string[]) => targetsForProviders(allowed, group).map(t => t.id)
    expect(ids(null, ['openai'])).toEqual(['codex'])
    expect(ids(['claude'], ['claude', 'openai'])).toEqual(['claude'])
    expect(ids(null, ['antigravity'])).toEqual(['claude-antigravity', 'gemini-antigravity'])
    expect(ids(['grok'])).toEqual(['grokbuild'])
    expect(ids(['openai'], ['claude'])).toEqual([])
    expect(ids(null, [])).toEqual([])
    expect(ids(['media'])).toEqual([])
    expect(ids(null, ['claude', 'openai'])).toEqual(['claude', 'codex'])
  })

  it('defaults new sessions to Opus 5.5 and keeps Fable 5.2 selectable', () => {
    const target = CC_SWITCH_TARGETS.find((t) => t.id === 'claude')
    expect(target).toBeDefined()

    const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(target!, baseOpts))

    expect(params.get('app')).toBe('claude')
    expect(params.get('endpoint')).toBe(`${baseOpts.origin}/api/claude`)
    expect(params.has('model')).toBe(false)
    expect(params.get('opusModel')).toBe('claude-opus-5-5')
    expect(params.get('sonnetModel')).toBe('claude-sonnet-5-5')
    expect(params.get('haikuModel')).toBe('claude-haiku-5-5')
    expect(JSON.parse(atob(params.get('config')!))).toEqual({ env: {
      ANTHROPIC_DEFAULT_MODEL: 'claude-opus-5-5',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5-2',
    } })
  })

  it('sets a Claude model supported by current Sub2API and routes Gemini separately', () => {
    const claude = paramsFromCcSwitchUrl(buildCcSwitchUrl(ccSwitchTarget('claude-sub2api')!, baseOpts))
    expect(claude.get('endpoint')).toBe(`${baseOpts.origin}/api/sub2api`)
    expect(JSON.parse(atob(claude.get('config')!))).toEqual({ env: {
      ANTHROPIC_DEFAULT_MODEL: 'claude-opus-5-5',
    } })
    for (const id of ['gemini', 'gemini-sub2api']) {
      const target = ccSwitchTarget(id)!
      const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(target, baseOpts))
      expect(params.get('endpoint')).toBe(`${baseOpts.origin}/api/${target.provider}`)
      expect(params.get('model')).toBe('gemini-3.8-flash')
    }
  })

  it('uses current DeepSeek, MiMo, GLM, Qwen and Kimi presets', () => {
    const glm = CC_SWITCH_TARGETS.find((t) => t.id === 'claude-zhipu')
    const qwen = CC_SWITCH_TARGETS.find((t) => t.id === 'claude-qwen')
    const kimi = CC_SWITCH_TARGETS.find((t) => t.id === 'codex-kimi')

    expect(ccSwitchTarget('claude-deepseek')?.models).toMatchObject({ model: 'deepseek-flash', opusModel: 'deepseek-v4-pro' })
    expect(ccSwitchTarget('claude-xiaomi')?.models).toMatchObject({ model: 'mimo-v2.6-pro', haikuModel: 'mimo-v2.6-flash' })
    expect(glm?.models).toMatchObject({ model: 'glm-5.3', haikuModel: 'glm-5.3-flash' })
    expect(qwen?.models).toEqual({
      model: 'qwen3.8-max',
      sonnetModel: 'qwen3.7-plus',
      haikuModel: 'qwen3.8-flash',
      opusModel: 'qwen3.8-max',
    })
    expect(paramsFromCcSwitchUrl(buildCcSwitchUrl(qwen!, baseOpts)).get('haikuModel')).toBe('qwen3.8-flash')
    expect(ccSwitchTarget('claude-kimi')?.models).toMatchObject({ model: 'kimi-k3.1-pro', haikuModel: 'kimi-k2.7-code' })
    const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(kimi!, baseOpts))
    expect(params.get('model')).toBe('kimi-k3.1-pro')
    expect(JSON.parse(atob(params.get('config')!)).config).toContain('model_context_window = 1048576')
  })

  it.each(CC_SWITCH_TARGETS)('uses the dedicated endpoint and shared balance origin for $id', target => {
    const apiKey = 'mb-test+value&more'
    const params = paramsFromCcSwitchUrl(buildCcSwitchUrl(target, { ...baseOpts, apiKey, origin: `${baseOpts.origin}/` }))
    const suffix = target.app === 'codex' || target.app === 'grokbuild' ? '/v1' : ''
    expect(params.get('endpoint')).toBe(`${baseOpts.origin}/api/${target.provider}${suffix}`)
    expect(params.get('usageBaseUrl')).toBe(baseOpts.origin)
    expect(params.get('usageApiKey')).toBe(apiKey)
    expect(params.get('apiKey')).toBe(apiKey)
    expect(atob(params.get('usageScript')!)).toContain('{{baseUrl}}/api/usage')
  })
})
