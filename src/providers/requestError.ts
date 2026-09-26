/** A local conversion error must not retry or penalize an upstream account. */
export class ProviderRequestError extends Error {
  readonly statusCode = 400
  constructor(readonly code: string, message: string) { super(message) }
}
