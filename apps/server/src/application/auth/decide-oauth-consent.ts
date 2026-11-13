import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { oauthLifetimes, type OAuthRepository, redirectWith } from '../../core/auth/oauth.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { AssistantAccess } from './shared/assistant-access.ts'
import {
  type AuthorizationRequest,
  checkAuthorizationRequest,
  type ConsentError,
  type OAuthRequestDeps,
} from './shared/oauth-request.ts'

type Deps = Omit<OAuthRequestDeps, 'oauthRepository'> & {
  oauthRepository: Pick<OAuthRepository, 'findClient' | 'saveClient' | 'createCode'>
  assistantAccess: Pick<AssistantAccess, 'administers'>
  tokens: SessionTokens
  logger: Logger
}

export type DecideOAuthConsentError = ConsentError | AppError<'oauth/access_denied'>

export const decideOAuthConsentFactory =
  (deps: Deps) =>
  async ({
    request,
    decision,
    mcpUrl,
    accountId,
    profileId,
  }: {
    request: AuthorizationRequest
    decision: 'allow' | 'deny'
    mcpUrl: string
    accountId: string
    profileId: string | undefined
  }): Promise<Result<{ redirectTo: string }, DecideOAuthConsentError>> => {
    const { oauthRepository, assistantAccess, tokens, clock, logger } = deps
    const checked = await checkAuthorizationRequest(deps, request, mcpUrl)
    if (!checked.ok) return checked
    if (decision === 'deny') {
      return ok({
        redirectTo: redirectWith(request.redirectUri, {
          error: 'access_denied',
          state: request.state,
        }),
      })
    }
    if (profileId === undefined || !assistantAccess.administers({ accountId, profileId }).ok) {
      return err(
        appError('oauth/access_denied', 'only an admin on an unrestricted profile may allow'),
      )
    }
    const code = tokens.generate()
    oauthRepository.createCode({
      codeHash: tokens.hash(code),
      clientId: checked.value.client.id,
      accountId,
      profileId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scope: checked.value.scope,
      expiresAt: new Date(clock.now().getTime() + oauthLifetimes.codeMs),
    })
    logger.info('oauth authorization granted', {
      accountId,
      oauthClientId: checked.value.client.id,
    })
    return ok({ redirectTo: redirectWith(request.redirectUri, { code, state: request.state }) })
  }

export type DecideOAuthConsent = ReturnType<typeof decideOAuthConsentFactory>
