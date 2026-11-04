import type { OAuthErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const oauthErrorStatus = {
  'oauth/invalid_client': 400,
  'oauth/invalid_redirect_uri': 400,
  'oauth/invalid_request': 400,
  'oauth/invalid_grant': 400,
  'oauth/unsupported_grant_type': 400,
  'oauth/access_denied': 403,
} satisfies ErrorStatusMap<OAuthErrorCode>
