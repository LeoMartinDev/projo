export const oauthErrorCodes = [
  'oauth/invalid_client',
  'oauth/invalid_redirect_uri',
  'oauth/invalid_request',
  'oauth/invalid_grant',
  'oauth/unsupported_grant_type',
  'oauth/access_denied',
] as const

export type OAuthErrorCode = (typeof oauthErrorCodes)[number]
