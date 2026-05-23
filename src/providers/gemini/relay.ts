const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com/v1internal'

/** Builds the cloudcode-pa endpoint URL for a given client-requested action. */
function endpointFor(action: string): string {
  // Map standard Gemini API actions onto cloudcode-pa equivalents.
  // `:streamGenerateContent` needs `?alt=sse` for SSE framing.
  if (action === 'streamGenerateContent') {
    return `${CODE_ASSIST_BASE}:streamGenerateContent?alt=sse`
  }
  return `${CODE_ASSIST_BASE}:${action}`
}

/**
 * cloudcode-pa expects every request wrapped in
 *   { model, project, request: <standard Gemini request> }
 * and returns responses wrapped in `{ response: <standard chunk> }`.
 * We adapt both directions so the client sees the public Gemini API shape.
 */
function wrapRequest(
  model: string,
  project: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return { model, project, request: body }
}

export interface GeminiRelayContext {
  model: string
  action: string
  project: string
}

export function relayGemini(
  accessToken: string,
  body: Record<string, unknown>,
  ctx: GeminiRelayContext,
): Promise<Response> {
  return fetch(endpointFor(ctx.action), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: ctx.action === 'streamGenerateContent' ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(wrapRequest(ctx.model, ctx.project, body)),
  })
}

/** Unwraps `{response: X}` to `X` for both SSE event payloads and full JSON bodies. */
export function unwrapResponseEnvelope(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'response' in payload) {
    return (payload as { response: unknown }).response
  }
  return payload
}
