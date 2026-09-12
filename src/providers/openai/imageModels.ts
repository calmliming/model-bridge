export const IMAGE_25_MODELS = [
  'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst',
  'gpt-image-2.5-flare-2026-09-08', 'gpt-image-2.5-sunburst-2026-09-08',
] as const
export function isImage25Model(model: string): boolean {
  return (IMAGE_25_MODELS as readonly string[]).includes(model)
}
