/**
 * OAuth 2.1 of the MCP server (§27.3). The consent page shows them; `/oauth/token` and
 * `/oauth/register` answer the RFC 6749 / 7591 `error` strings instead.
 */
export const oauthErrorCodes = [
  /** Unknown `client_id`, or a Client ID Metadata Document that cannot be read or does not match. */
  'oauth/invalid_client',
  /** `redirect_uri` is not one of the client's. */
  'oauth/invalid_redirect_uri',
  /** Missing or wrong parameter: response type, PKCE (S256), resource. */
  'oauth/invalid_request',
  /** Expired, used or revoked code or refresh token, or a PKCE verifier that does not match. */
  'oauth/invalid_grant',
  'oauth/unsupported_grant_type',
  /** Only an admin on an unrestricted active profile may connect an assistant (§15). */
  'oauth/access_denied',
] as const

export type OAuthErrorCode = (typeof oauthErrorCodes)[number]
