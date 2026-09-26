export function usageSourceLabel(source?: string): string {
  return ({ upstream: '上游完整用量', partial: '部分用量', missing: '用量缺失', unknown: '来源未知' } as Record<string, string>)[source ?? 'unknown'] ?? '来源未知'
}
