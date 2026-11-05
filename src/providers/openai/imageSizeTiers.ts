export type ImageSizeTier = '1K' | '2K' | '4K'
export function imageSizeTier(value: unknown): ImageSizeTier | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(value)
  if (!match) return null
  const side = Math.max(Number(match[1]), Number(match[2]))
  return side <= 1024 ? '1K' : side <= 2048 ? '2K' : '4K'
}
export function requestedImageTier(body: Record<string, unknown>, imageEndpoint: boolean): ImageSizeTier | undefined {
  const tool = Array.isArray(body.tools) ? body.tools.find(t => t?.type === 'image_generation') : undefined
  return imageEndpoint || tool ? imageSizeTier(tool?.size ?? body.size) ?? undefined : undefined
}
export function accountAllowsImageTier(metadata: unknown, tier: ImageSizeTier): boolean {
  const list = (metadata as { imageSizeTiers?: unknown } | null)?.imageSizeTiers
  return !Array.isArray(list) || list.length === 0 || list.includes(tier)
}
export function imageTierPreference(metadata: unknown): number {
  const list = (metadata as { imageSizeTiers?: unknown } | null)?.imageSizeTiers
  return !Array.isArray(list) || !list.length || new Set(list).size === 3 ? 0 : list.includes('4K') ? 1 : list.includes('2K') ? 2 : 3
}
