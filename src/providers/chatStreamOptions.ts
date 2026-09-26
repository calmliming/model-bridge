/** Request the final usage frame without losing provider-specific stream options. */
export function chatStreamOptions(value: unknown): Record<string, unknown> {
  return {
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    include_usage: true,
  }
}
