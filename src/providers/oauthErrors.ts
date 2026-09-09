/** Safe, actionable provider configuration diagnostics; never include secret values. */
export class OAuthConfigurationError extends Error {
  readonly statusCode = 503
  readonly code = 'oauth_not_configured'

  constructor(
    readonly provider: string,
    readonly missingVariables: string[],
    message: string,
  ) {
    super(message)
    this.name = 'OAuthConfigurationError'
  }
}
