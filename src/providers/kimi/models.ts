export const KIMI_K31_PRO = 'kimi-k3.1-pro'
export const KIMI_K31_PRO_HIGHSPEED = 'kimi-k3.1-pro-highspeed'

export function isKimiK31Model(model: string): boolean {
  const id = model.toLowerCase()
  return id === KIMI_K31_PRO || id === KIMI_K31_PRO_HIGHSPEED
}
