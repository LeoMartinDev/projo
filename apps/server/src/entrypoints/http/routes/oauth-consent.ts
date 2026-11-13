import { Hono } from 'hono'

import { mcpPath } from '@projo/shared/api/assistants'
import {
  type OAuthAuthorizeQuery,
  oauthAuthorizeQuerySchema,
  type OAuthConsentDto,
  type OAuthDecisionResponse,
  oauthDecisionBodySchema,
} from '@projo/shared/api/oauth'

import type { DecideOAuthConsent } from '../../../application/auth/decide-oauth-consent.ts'
import type { GetOAuthConsent } from '../../../application/auth/get-oauth-consent.ts'
import type { AuthorizationRequest } from '../../../application/auth/shared/oauth-request.ts'
import { clientInfo } from '../client-info.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentPrincipal } from '../principal.ts'
import { validate } from '../validation.ts'

const toRequest = (query: OAuthAuthorizeQuery): AuthorizationRequest => ({
  responseType: query.response_type,
  clientId: query.client_id,
  redirectUri: query.redirect_uri,
  codeChallenge: query.code_challenge,
  codeChallengeMethod: query.code_challenge_method,
  ...(query.state === undefined ? {} : { state: query.state }),
  ...(query.scope === undefined ? {} : { scope: query.scope }),
  ...(query.resource === undefined ? {} : { resource: query.resource }),
})

export const oauthConsentRoutes = ({
  getOAuthConsent,
  decideOAuthConsent,
  trustProxy,
}: {
  getOAuthConsent: GetOAuthConsent
  decideOAuthConsent: DecideOAuthConsent
  trustProxy: boolean
}) =>
  new Hono<AppEnv>()
    .get('/oauth/authorize', validate('query', oauthAuthorizeQuerySchema), async (c) => {
      const { account } = currentPrincipal(c)
      const { origin } = clientInfo(c, { trustProxy })
      const consent = await getOAuthConsent({
        request: toRequest(c.req.valid('query')),
        mcpUrl: `${origin}${mcpPath}`,
        accountId: account.id,
        profileId: c.get('profileId'),
      })
      return consent.ok
        ? c.json(consent.value satisfies OAuthConsentDto, 200)
        : respondError(c, consent.error)
    })
    .post('/oauth/authorize', validate('json', oauthDecisionBodySchema), async (c) => {
      const { account } = currentPrincipal(c)
      const { origin } = clientInfo(c, { trustProxy })
      const { decision, ...query } = c.req.valid('json')
      const decided = await decideOAuthConsent({
        request: toRequest(query),
        decision,
        mcpUrl: `${origin}${mcpPath}`,
        accountId: account.id,
        profileId: c.get('profileId'),
      })
      return decided.ok
        ? c.json(decided.value satisfies OAuthDecisionResponse, 200)
        : respondError(c, decided.error)
    })

export type OAuthConsentRoutes = ReturnType<typeof oauthConsentRoutes>
