import { Agent, ProxyAgent, type Dispatcher } from 'undici'
import { registerUpstreamResponse, upstreamSignal } from './cancellation'
import {
  assertSafeUpstreamEgress,
  guardedUpstreamLookup,
  isConfiguredUpstreamHost,
} from './urlGuard'

const guardedDispatcher = new Agent({ connect: { lookup: guardedUpstreamLookup } })

/**
 * 出站代理解析顺序：UPSTREAM_PROXY_URL → HTTPS_PROXY → HTTP_PROXY。
 *
 * 为什么必须有这一层：Node 进程【不使用系统代理】。在只能经代理出网的
 * 环境（容器、受限网络）里，没有它则所有上游请求都会直接超时——
 * Google 公钥校验、模型目录同步、余额查询都受影响。
 *
 * 只在请求时读取，不用模块级缓存：配置来自 .env.local，而本模块可能在
 * config 之前被求值，缓存 undefined 会让代理永久失效。同时这也让运维
 * 改完环境变量重启即生效，不需要改动调用方。
 */
function upstreamProxyUrl(): string | undefined {
  const raw = process.env.UPSTREAM_PROXY_URL?.trim()
    || process.env.HTTPS_PROXY?.trim()
    || process.env.HTTP_PROXY?.trim()
    || process.env.https_proxy?.trim()
    || process.env.http_proxy?.trim()
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (!['http:', 'https:', 'socks5:'].includes(url.protocol)) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

let proxyAgent: ProxyAgent | undefined
let proxyAgentUrl: string | undefined

function proxyDispatcher(url: string): ProxyAgent {
  if (!proxyAgent || proxyAgentUrl !== url) {
    void proxyAgent?.close()
    proxyAgent = new ProxyAgent(url)
    proxyAgentUrl = url
  }
  return proxyAgent
}

/** Fetch an upstream request with a connect/header deadline, without cutting long SSE streams. */
export async function fetchWithConnectTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
  dispatcher?: Dispatcher,
): Promise<Response> {
  const safeUrl = await assertSafeUpstreamEgress(input)
  const controller = new AbortController()
  const signals = [controller.signal, init.signal, upstreamSignal()].filter((signal): signal is AbortSignal => !!signal)
  const signal = AbortSignal.any(signals)
  signal.throwIfAborted()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // 运维显式配置的 host（内网网关等）优先：既允许私有地址，也让调用方
    // 自行决定是否经代理。内置公共 host 在配置了代理时走代理，否则仍用
    // 带 DNS 校验的 guarded dispatcher（保持 SSRF 防护）。
    const proxy = upstreamProxyUrl()
    const selected = dispatcher
      ?? (isConfiguredUpstreamHost(safeUrl.hostname)
        ? undefined
        : proxy ? proxyDispatcher(proxy) : guardedDispatcher)
    const fetchInit = {
      ...init,
      signal,
      // Redirects are rejected instead of following an unvalidated Location
      // to a private address. Upstream API endpoints are expected to be canonical.
      redirect: 'error',
      ...(selected ? { dispatcher: selected } : {}),
    } as RequestInit
    const response = await fetch(safeUrl.toString(), fetchInit)
    registerUpstreamResponse(response, controller)
    clearTimeout(timer)
    return response
  } catch (error) {
    clearTimeout(timer)
    throw error
  }
}

export async function closeUpstreamDispatcher(): Promise<void> {
  await Promise.all([guardedDispatcher.close(), proxyAgent?.close()])
  proxyAgent = undefined
  proxyAgentUrl = undefined
}
