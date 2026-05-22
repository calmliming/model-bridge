/** Formats an epoch-millisecond timestamp as a short local date-time string. */
export function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
