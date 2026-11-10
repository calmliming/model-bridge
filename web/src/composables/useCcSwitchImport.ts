import { ref, watch } from 'vue'
import { buildCcSwitchUrl, ccSwitchProviderName, launchCcSwitch, targetsForProviders, type CcSwitchRuntimeConfig, type CcSwitchTarget } from '../ccswitch'
import { useMessage } from './useMessage'

let runtimeConfig: CcSwitchRuntimeConfig = {}

export function setCcSwitchRuntimeConfig(config: CcSwitchRuntimeConfig) {
  runtimeConfig = config
}

export function useCcSwitchImport() {
  const message = useMessage()
  const showCcSwitch = ref(false)
  const ccSwitchTargets = ref<CcSwitchTarget[]>([])
  let pending: { apiKey: string } | null = null

  watch(showCcSwitch, shown => {
    if (!shown) pending = null
  }, { flush: 'sync' })

  async function launch(target: CcSwitchTarget, direct = false) {
    const current = pending
    if (!current) return
    const url = buildCcSwitchUrl(target, {
      ...runtimeConfig,
      origin: window.location.origin,
      apiKey: current.apiKey,
      name: ccSwitchProviderName(target),
    })
    const launched = await launchCcSwitch(url)
    if (pending !== current) return
    if (launched) {
      pending = null
      showCcSwitch.value = false
      message.success('已唤起 CC Switch，请在应用中确认导入')
    } else if (direct) {
      // Fetching a saved key can outlast the browser's user-activation window.
      // The single-button picker gives the user a fresh click to launch it.
      showCcSwitch.value = true
    } else {
      message.warning('未能唤起 CC Switch，请确认已安装并允许浏览器打开该应用')
    }
  }

  function beginCcSwitchImport(
    apiKey: string,
    allowedProviders?: readonly string[] | null,
    groupProviders?: readonly string[] | null,
  ) {
    const targets = targetsForProviders(allowedProviders, groupProviders)
    if (!targets.length) {
      message.warning('此 Key 的分组和服务商权限没有可用的 CC Switch 导入项')
      return
    }
    pending = { apiKey }
    ccSwitchTargets.value = targets
    if (targets.length === 1) void launch(targets[0]!, true)
    else showCcSwitch.value = true
  }

  return { showCcSwitch, ccSwitchTargets, beginCcSwitchImport, triggerCcSwitch: launch }
}
