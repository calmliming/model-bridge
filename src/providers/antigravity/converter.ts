import { sanitizeGeminiBody } from '../gemini/relay'
import { object } from './client'

export class AntigravityRequestError extends Error {
  readonly statusCode = 400
  readonly code = 'invalid_antigravity_request'
}

function blocks(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  if (!Array.isArray(value)) throw new AntigravityRequestError('Messages content must be text or an array of blocks')
  return value.map(block => {
    const item = object(block)
    if (!item) throw new AntigravityRequestError('Invalid message content block')
    return item
  })
}

function media(block: Record<string, unknown>): Record<string, unknown> {
  const source = object(block.source)
  if (source?.type !== 'base64' || typeof source.data !== 'string' || typeof source.media_type !== 'string') {
    throw new AntigravityRequestError('Antigravity Messages supports base64 image/document sources; use native Gemini for other media formats')
  }
  return { inlineData: { mimeType: source.media_type, data: source.data } }
}

/** Translate Messages to Gemini without altering tool arguments or signed history. */
export function messagesToGemini(body: Record<string, unknown>, model: string): Record<string, unknown> {
  if (!Array.isArray(body.messages)) throw new AntigravityRequestError('messages must be an array')
  const names = new Map<string, string>()
  const contents: Record<string, unknown>[] = []
  for (const raw of body.messages) {
    const message = object(raw)
    if (!message || !['user', 'assistant'].includes(String(message.role))) throw new AntigravityRequestError('Messages roles must be user or assistant')
    const parts: Record<string, unknown>[] = []
    for (const block of blocks(message.content)) {
      switch (block.type) {
        case 'text':
          if (typeof block.text !== 'string') throw new AntigravityRequestError('Text blocks require text')
          parts.push({ text: block.text })
          break
        case 'thinking':
          if (typeof block.signature !== 'string' || !block.signature) throw new AntigravityRequestError('Thinking history requires its original Antigravity signature; start a new conversation when switching providers')
          parts.push({ text: typeof block.thinking === 'string' ? block.thinking : '', thought: true, thoughtSignature: block.signature })
          break
        case 'image': case 'document':
          parts.push(media(block))
          break
        case 'tool_use': {
          if (typeof block.id !== 'string' || typeof block.name !== 'string' || !object(block.input)) throw new AntigravityRequestError('Tool calls require id, name and object input')
          names.set(block.id, block.name)
          parts.push({ functionCall: { id: block.id, name: block.name, args: block.input },
            ...(typeof block.signature === 'string' ? { thoughtSignature: block.signature } : {}) })
          break
        }
        case 'tool_result': {
          const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
          const name = names.get(id)
          if (!name) throw new AntigravityRequestError('Tool result has no matching tool call in the supplied history')
          const attachments: Record<string, unknown>[] = []
          let content = block.content ?? ''
          if (Array.isArray(content)) {
            content = content.map(raw => {
              const item = object(raw)
              if (item?.type === 'text' && typeof item.text === 'string') return item.text
              if (item && (item.type === 'image' || item.type === 'document')) {
                attachments.push(media(item))
                return '[media attached]'
              }
              throw new AntigravityRequestError('Unsupported tool result content block')
            }).join('\n')
          }
          const response = block.is_error === true ? { error: content } : { result: content }
          parts.push({ functionResponse: { id, name, response } })
          parts.push(...attachments)
          break
        }
        default:
          throw new AntigravityRequestError(`Unsupported Messages block type: ${String(block.type).slice(0, 60)}`)
      }
    }
    if (parts.length) contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts })
  }
  const result: Record<string, unknown> = { contents }
  if (body.system != null) {
    const parts = blocks(body.system).map(block => {
      if (block.type !== 'text' || typeof block.text !== 'string') throw new AntigravityRequestError('System instructions must be text')
      return { text: block.text }
    })
    result.systemInstruction = { role: 'user', parts }
  }
  const generationConfig: Record<string, unknown> = {}
  for (const [from, to] of [['temperature', 'temperature'], ['top_p', 'topP'], ['top_k', 'topK'], ['stop_sequences', 'stopSequences']] as const) {
    if (body[from] !== undefined) generationConfig[to] = body[from]
  }
  const requested = typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens) && body.max_tokens > 0 ? Math.trunc(body.max_tokens) : 4096
  generationConfig.maxOutputTokens = Math.min(requested, 64000)
  const thinking = object(body.thinking)
  if (thinking?.type === 'disabled') generationConfig.thinkingConfig = { includeThoughts: false, thinkingBudget: 0 }
  if (thinking?.type === 'enabled' || thinking?.type === 'adaptive') {
    const budget = typeof thinking.budget_tokens === 'number' ? thinking.budget_tokens : 8192
    if (!Number.isFinite(budget) || budget < 0) throw new AntigravityRequestError('Invalid thinking budget')
    generationConfig.maxOutputTokens = Math.min(64000, Math.max(requested, Math.trunc(budget) + 1))
    generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: Math.min(63999, Math.trunc(budget)) }
  }
  result.generationConfig = generationConfig
  const declarations: Record<string, unknown>[] = []
  let search = false
  for (const raw of Array.isArray(body.tools) ? body.tools : []) {
    const tool = object(raw)
    if (!tool || typeof tool.name !== 'string') throw new AntigravityRequestError('Invalid tool definition')
    if (typeof tool.type === 'string' && tool.type.startsWith('web_search')) { search = true; continue }
    if (tool.type && tool.type !== 'custom') throw new AntigravityRequestError('This server-side tool is not supported by the Antigravity adapter')
    declarations.push({ name: tool.name, ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
      parameters: tool.input_schema ?? { type: 'object', properties: {} } })
  }
  if (search && declarations.length) throw new AntigravityRequestError('Antigravity does not support mixing built-in web search with function tools; use one tool mode per request')
  if (search && !model.startsWith('gemini-')) throw new AntigravityRequestError('Built-in web search requires a Gemini model; the gateway does not silently change the requested model')
  if (declarations.length) result.tools = [{ functionDeclarations: declarations }]
  if (search) result.tools = [{ googleSearch: {} }]
  const choice = object(body.tool_choice)
  const mode = choice?.type === 'none' ? 'NONE' : choice?.type === 'any' || choice?.type === 'tool' ? 'ANY' : 'VALIDATED'
  if (choice?.type === 'tool' && typeof choice.name !== 'string') throw new AntigravityRequestError('Named tool choice requires a tool name')
  result.toolConfig = { functionCallingConfig: { mode, ...(choice?.type === 'tool' ? { allowedFunctionNames: [choice.name] } : {}) } }
  return { ...sanitizeGeminiBody(result, model), stream: body.stream === true, ...(body.metadata ? { metadata: body.metadata } : {}) }
}

export function prepareAntigravityGemini(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const cleaned = { ...sanitizeGeminiBody(body, model) }
  const tools = Array.isArray(cleaned.tools) ? cleaned.tools.map(object) : []
  if (tools.some(tool => Array.isArray(tool?.functionDeclarations) && tool.functionDeclarations.length)
    && tools.some(tool => tool?.googleSearch || tool?.googleSearchRetrieval || tool?.codeExecution)) {
    throw new AntigravityRequestError('Antigravity cannot mix built-in tools and function declarations in one request')
  }
  const generation = object(cleaned.generationConfig)
  if (generation && typeof generation.maxOutputTokens === 'number' && generation.maxOutputTokens > 64000) {
    cleaned.generationConfig = { ...generation, maxOutputTokens: 64000 }
  }
  const toolConfig = object(cleaned.toolConfig) ?? {}
  return { ...cleaned, toolConfig: { ...toolConfig, functionCallingConfig: object(toolConfig.functionCallingConfig) ?? { mode: 'VALIDATED' } } }
}
