import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCcSwitchImport, setCcSwitchRuntimeConfig } from './src/composables/useCcSwitchImport'

const mocks = vi.hoisted(() => ({ launch: vi.fn(), warning: vi.fn(), success: vi.fn() }))
vi.mock('./src/ccswitch', async original => ({
  ...await original<typeof import('./src/ccswitch')>(),
  launchCcSwitch: mocks.launch,
}))
vi.mock('./src/composables/useMessage', () => ({
  useMessage: () => ({ warning: mocks.warning, success: mocks.success }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.launch.mockReset().mockResolvedValue(true)
  vi.stubGlobal('window', { location: { origin: 'https://console.example.com' } })
  setCcSwitchRuntimeConfig({ ccSwitchApiBaseUrl: 'https://gateway.example.com' })
})
afterEach(() => vi.unstubAllGlobals())

describe('one-click CC Switch flow', () => {
  it('launches a single client from the group without opening the picker', async () => {
    const state = useCcSwitchImport()
    state.beginCcSwitchImport('mb-fake', null, ['openai'])
    expect(state.showCcSwitch.value).toBe(false)
    expect(mocks.launch).toHaveBeenCalledOnce()
    const { searchParams } = new URL(mocks.launch.mock.calls[0]![0])
    expect(searchParams.get('app')).toBe('codex')
    expect(searchParams.get('endpoint')).toBe('https://gateway.example.com/api/openai/v1')
    await Promise.resolve()
    expect(mocks.success).toHaveBeenCalledOnce()
  })

  it('opens the Antigravity chooser and launches the selected client', async () => {
    const state = useCcSwitchImport()
    state.beginCcSwitchImport('mb-fake', ['antigravity'], ['antigravity'])
    expect(state.showCcSwitch.value).toBe(true)
    expect(mocks.launch).not.toHaveBeenCalled()
    await state.triggerCcSwitch(state.ccSwitchTargets.value.find(t => t.app === 'gemini')!)
    expect(new URL(mocks.launch.mock.calls[0]![0]).searchParams.get('app')).toBe('gemini')
    expect(state.showCcSwitch.value).toBe(false)
  })

  it('offers a single retry if the browser blocks the direct launch', async () => {
    mocks.launch.mockResolvedValueOnce(false)
    const state = useCcSwitchImport()
    state.beginCcSwitchImport('mb-fake', ['claude'])
    await Promise.resolve()
    expect(state.showCcSwitch.value).toBe(true)
    expect(state.ccSwitchTargets.value.map(t => t.id)).toEqual(['claude'])
    await state.triggerCcSwitch(state.ccSwitchTargets.value[0]!)
    expect(mocks.launch).toHaveBeenCalledTimes(2)
    expect(state.showCcSwitch.value).toBe(false)
  })

  it('never launches an unrelated provider for a key with no matching import targets', () => {
    const state = useCcSwitchImport()
    state.beginCcSwitchImport('mb-fake', ['openai'], ['gemini'])
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(state.showCcSwitch.value).toBe(false)
    expect(mocks.warning).toHaveBeenCalledOnce()
  })
})
