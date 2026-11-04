import { Hono } from 'hono'

import { mcpPath } from '@projo/shared/api/assistants'
import {
  type OAuthAuthorizeQuery,
  oauthAuthorizeQuerySchema,
  type OAuthConsentDto,
  type OAuthDecisionResponse,
  oauthDecisionBodySchema,
} from '@projo/shared/api/oauth'

import type { AuthorizationRequest, OAuth } from '../../../application/auth/oauth.ts'
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

/**
 * §27.3 consent, for the web page `/oauth/authorize`: `GET /oauth/authorize` describes the request,
 * `POST /oauth/authorize` records the decision and says where to go. Signed-in accounts only (the
 * `authenticate` middleware); the assistant acts as the active profile. Mounted at `/api/v1`.
 */
export const oauthConsentRoutes = ({ oauth, trustProxy }: { oauth: OAuth; trustProxy: boolean }) =>
  new Hono<AppEnv>()
    .get('/oauth/authorize', validate('query', oauthAuthorizeQuerySchema), async (c) => {
      const { account } = currentPrincipal(c)
      const { origin } = clientInfo(c, { trustProxy })
      const consent = await oauth.consent({
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
      const decided = await oauth.decide({
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
