import { ProxyAgent } from 'undici'
import { config } from '../../config'
import { fetchWithConnectTimeout } from '../../http/upstream'
import { googleErrorMessage } from '../google/errors'

const HOSTS = new Set(['oauth2.googleapis.com', 'cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com'])
let proxy: ProxyAgent | undefined

export const antigravityUserAgent = () => `antigravity/${config.ANTIGRAVITY_USER_AGENT_VERSION} ${process.platform}/${process.arch}`

/** All native Antigravity traffic shares the administrator's configured egress. */
export function fetchAntigravity(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || !HOSTS.has(target.hostname) || target.username || target.password || (target.port && target.port !== '443')) {
    throw new Error('Unsupported Antigravity upstream endpoint')
  }
  if (config.ANTIGRAVITY_PROXY_URL) proxy ??= new ProxyAgent(config.ANTIGRAVITY_PROXY_URL)
  return fetchWithConnectTimeout(url, init, timeoutMs, proxy)
}

export async function closeAntigravityDispatcher(): Promise<void> {
  const active = proxy
  proxy = undefined
  await active?.close()
}

export function antigravityHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': antigravityUserAgent(), accept: 'application/json' }
}

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export async function antigravityJson(token: string, action: 'loadCodeAssist' | 'onboardUser' | 'fetchAvailableModels', body: unknown): Promise<Record<string, unknown>> {
  const response = await fetchAntigravity(`https://cloudcode-pa.googleapis.com/v1internal:${action}`, {
    method: 'POST', headers: antigravityHeaders(token), body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`${action} failed (${response.status}): ${googleErrorMessage(response.status, await response.text())}`)
  const data = object(await response.json())
  if (!data) throw new Error(`${action} returned invalid JSON`)
  if (data.error) throw new Error(`${action} failed (400): ${googleErrorMessage(400, JSON.stringify(data))}`)
  return data
}
