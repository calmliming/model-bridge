/** Model ownership is independent of the account/channel carrying the request. */
export const MODEL_MANUFACTURERS = [
  { id: 'openai', label: 'OpenAI', pattern: '(^|[/:])(gpt-|chatgpt-|o[1-9]([.-]|$)|dall-e|sora)', providers: ['openai'] },
  { id: 'anthropic', label: 'Anthropic', pattern: '(^|[/:])claude', providers: ['claude'] },
  { id: 'google', label: 'Google', pattern: '(^|[/:])(gemini|imagen|veo)', providers: ['gemini'] },
  { id: 'deepseek', label: 'DeepSeek', pattern: '(^|[/:])deepseek', providers: ['deepseek'] },
  { id: 'xiaomi', label: '小米', pattern: '(^|[/:])mimo', providers: ['xiaomi'] },
  { id: 'zhipu', label: '智谱', pattern: '(^|[/:])(glm|cogview|cogvideo)', providers: ['zhipu'] },
  { id: 'alibaba', label: '阿里巴巴', pattern: '(^|[/:])(qwen|qwq|wan[.-])', providers: ['qwen'] },
  { id: 'moonshot', label: '月之暗面', pattern: '(^|[/:])(kimi|moonshot|k[23]([.-]|$))', providers: ['kimi'] },
  { id: 'minimax', label: 'MiniMax', pattern: '(^|[/:])(minimax|hailuo)', providers: ['minimax'] },
  { id: 'xai', label: 'xAI', pattern: '(^|[/:])grok', providers: ['grok'] },
  { id: 'unknown', label: '未知厂家', pattern: null, providers: [] },
] as const

/** Expressions are internal SQL column references; values never come from a query string. */
export function modelManufacturerSql(model: string, provider: string): string {
  const rules = MODEL_MANUFACTURERS.filter(rule => rule.pattern)
  return `CASE ${rules.map(rule => `WHEN ${model} ~* '${rule.pattern}' THEN '${rule.id}'`).join(' ')}
    ${rules.filter(rule => rule.providers.length).map(rule => `WHEN ${provider} IN (${rule.providers.map(p => `'${p}'`).join(',')}) THEN '${rule.id}'`).join(' ')}
    ELSE 'unknown' END`
}
