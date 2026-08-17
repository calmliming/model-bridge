import { Agent } from 'undici'
import {
  assertSafeUpstreamEgress,
  guardedUpstreamLookup,
  isConfiguredUpstreamHost,
} from './urlGuard'

const guardedDispatcher = new Agent({ connect: { lookup: guardedUpstreamLookup } })

/** Fetch an upstream request with a connect/header deadline, without cutting long SSE streams. */
export async function fetchWithConnectTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const safeUrl = await assertSafeUpstreamEgress(input)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const fetchInit = {
      ...init,
      signal: controller.signal,
      // Redirects are rejected instead of following an unvalidated Location
      // to a private address. Upstream API endpoints are expected to be canonical.
      redirect: 'error',
      ...(isConfiguredUpstreamHost(safeUrl.hostname)
        ? {}
        : { dispatcher: guardedDispatcher }),
    } as RequestInit
    const response = await fetch(safeUrl.toString(), fetchInit)
    clearTimeout(timer)
    return response
  } catch (error) {
    clearTimeout(timer)
    throw error
  }
}

export async function closeUpstreamDispatcher(): Promise<void> {
  await guardedDispatcher.close()
}
