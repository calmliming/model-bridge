export const GRSAI_IMAGE_MODELS = ['gpt-image-2', 'gpt-image-2-vip', 'gpt-image-2.5', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const
export const GRSAI_MODELS = [...GRSAI_IMAGE_MODELS, 'minimax-h3']
export const isGrsaiImageModel = (model: string): boolean => (GRSAI_IMAGE_MODELS as readonly string[]).includes(model)

// Reference prices from https://grsai.com/zh/dashboard/models, 2026-10-03.
// Use the project's fixed CNY → USD rate; DB / file overrides remain available.
export const GRSAI_IMAGE_PRICES: Record<string, number> = {
  'gpt-image-2': 0.0042, 'gpt-image-2-vip': 0.014,
  'gpt-image-2.5': 0.0042, 'gpt-image-2.5-flare': 0.014, 'gpt-image-2.5-sunburst': 0.0168,
}
export const GRSAI_VIDEO_PRICES = { '480p': 0.007, '768p': 0.0098, '1080p': 0.021 } as const
