import { createHash, randomUUID } from 'node:crypto'
import { config } from '../../config'
import { prepareAntigravityGemini } from './converter'
import { antigravityHeaders, fetchAntigravity, object } from './client'
import { recallToolSignature, type SignatureScope } from './signatures'

export function relayAntigravity(token: string, body: Record<string, unknown>, scope: SignatureScope & { project: string; action: string }): Promise<Response> {
  const { stream: _stream, model: _model, metadata: _metadata, ...input } = body
  const request = prepareAntigravityGemini(input, scope.model)
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
    body: JSON.stringify({ model: scope.model, project: scope.project, userAgent: 'antigravity', requestType,
      requestId: `agent-${randomUUID()}`, request: { ...request, contents, sessionId } }),
  }, 60_000)
}
