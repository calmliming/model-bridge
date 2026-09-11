import { AsyncLocalStorage } from 'node:async_hooks'

const requestSignal = new AsyncLocalStorage<AbortSignal>()
const responseControllers = new WeakMap<Response, AbortController>()

/** Scope cancellation to one relay request, including provider-internal retries. */
export function withUpstreamSignal<T>(signal: AbortSignal, run: () => T): T {
  return requestSignal.run(signal, run)
}

export function upstreamSignal(): AbortSignal | undefined {
  return requestSignal.getStore()
}

export function registerUpstreamResponse(response: Response, controller: AbortController): void {
  responseControllers.set(response, controller)
}

/** Abort the transport first: canceling one branch of a cloned body can hang. */
export async function cancelUpstreamResponse(response: Response): Promise<void> {
  responseControllers.get(response)?.abort()
  await response.body?.cancel().catch(() => {})
}
