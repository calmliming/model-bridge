import { Agent, type Dispatcher } from 'undici'
import { registerUpstreamResponse, upstreamSignal } from './cancellation'
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
  dispatcher?: Dispatcher,
): Promise<Response> {
  const safeUrl = await assertSafeUpstreamEgress(input)
  const controller = new AbortController()
  const signals = [controller.signal, init.signal, upstreamSignal()].filter((signal): signal is AbortSignal => !!signal)
  const signal = AbortSignal.any(signals)
  signal.throwIfAborted()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const fetchInit = {
      ...init,
      signal,
      // Redirects are rejected instead of following an unvalidated Location
      // to a private address. Upstream API endpoints are expected to be canonical.
      redirect: 'error',
      ...(dispatcher ? { dispatcher } : isConfiguredUpstreamHost(safeUrl.hostname)
        ? {}
        : { dispatcher: guardedDispatcher }),
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
  await guardedDispatcher.close()
}
