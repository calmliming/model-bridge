/** Fetch an upstream request with a connect/header deadline, without cutting long SSE streams. */
export async function fetchWithConnectTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    clearTimeout(timer)
    return response
  } catch (error) {
    clearTimeout(timer)
    throw error
  }
}
