export const IMAGE_25_MODELS = [
  'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst-2026-09-08',
] as const
export const IMAGE_26_MODELS = ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'] as const
export const NATIVE_IMAGE_MODELS = [...IMAGE_25_MODELS, ...IMAGE_26_MODELS] as const

export function isImage25Model(model: string): boolean {
  return (IMAGE_25_MODELS as readonly string[]).includes(model.toLowerCase())
}
export function isImage26Model(model: string): boolean {
  return (IMAGE_26_MODELS as readonly string[]).includes(model.toLowerCase())
}
export function isNativeImageModel(model: string): boolean {
  return isImage25Model(model) || isImage26Model(model)
}

export function imageOutputMime(format: string): string {
  return ({ png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp',
    svg: 'image/svg+xml', gif: 'image/gif' } as Record<string, string>)[format] ?? 'image/png'
}
