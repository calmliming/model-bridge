import { createHash, randomUUID } from 'node:crypto'
import { config } from '../../config'
import { prepareAntigravityGemini } from './converter'
import { antigravityHeaders, fetchAntigravity, object } from './client'
import { recallToolSignature, type SignatureScope } from './signatures'
import { resolveAntigravityModel } from './model'
import { antigravityThinking } from './thinking'

export function relayAntigravity(token: string, body: Record<string, unknown>, scope: SignatureScope & {
  project: string; action: string; models?: unknown; thinkingLevel?: string; thinkingExplicit?: boolean; preserveModel?: boolean
}): Promise<Response> {
  const { stream: _stream, model: _model, metadata: _metadata, ...input } = body
  const thinking = antigravityThinking(input, scope.model)
  const model = resolveAntigravityModel(scope.model, scope.models, scope.thinkingLevel ?? thinking.level,
    scope.preserveModel, scope.thinkingExplicit ?? thinking.explicit)
  const request = prepareAntigravityGemini(input, model)
  const contents = Array.isArray(request.contents) ? request.contents.map(raw => {
    const content = object(raw)
    if (!content || !Array.isArray(content.parts)) return raw
    return { ...content, parts: content.parts.map(rawPart => {
      const part = object(rawPart)
      const call = object(part?.functionCall)
      if (!part || part.thoughtSignature || typeof call?.id !== 'string') return rawPart
      const signature = recallToolSignature(scope, call.id)
      return signature ? { ...part, thoughtSignature: signature } : rawPart
    }) }
  }) : request.contents
  const clientSession = scope.sessionKeyHash ?? (typeof request.sessionId === 'string' ? request.sessionId
    : JSON.stringify(Array.isArray(contents) ? contents.find(item => object(item)?.role === 'user') ?? contents[0] : contents)
  )
  const sessionId = createHash('sha256').update(`${scope.apiKeyId}:${clientSession ?? ''}`).digest('hex').slice(0, 32)
  const action = scope.action === 'messages' ? 'streamGenerateContent' : scope.action
  const streaming = action === 'streamGenerateContent'
  const requestType = Array.isArray(request.tools) && request.tools.some(tool => object(tool)?.googleSearch) ? 'web_search' : 'agent'
  return fetchAntigravity(`https://${config.ANTIGRAVITY_API_HOST}/v1internal:${action}${streaming ? '?alt=sse' : ''}`, {
    method: 'POST', headers: { ...antigravityHeaders(token), accept: streaming ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify({ model, project: scope.project, userAgent: 'antigravity', requestType,
      requestId: `agent-${randomUUID()}`, request: { ...request, contents, sessionId } }),
  }, 60_000)
}
