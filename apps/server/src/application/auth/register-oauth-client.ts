import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  isAcceptableRedirectUri,
  type OAuthClient,
  type OAuthRepository,
} from '../../core/auth/oauth.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  oauthRepository: Pick<OAuthRepository, 'saveClient'>
  tokens: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type RegisterOAuthClientError = AppError<
  'oauth/invalid_redirect_uri' | 'oauth/invalid_request'
>

export const registerOAuthClientFactory =
  ({ oauthRepository, tokens, clock, ids, logger }: Deps) =>
  ({
    clientName,
    redirectUris,
  }: {
    clientName?: string
    redirectUris: string[]
  }): Result<OAuthClient, RegisterOAuthClientError> => {
    if (redirectUris.length === 0) {
      return err(appError('oauth/invalid_request', 'redirect_uris is required'))
    }
    const refused = redirectUris.find((uri) => !isAcceptableRedirectUri(uri))
    if (refused !== undefined) {
      return err(
        appError('oauth/invalid_redirect_uri', 'redirect URIs must be HTTPS or loopback', {
          context: { redirectUri: refused },
        }),
      )
    }
    const client = oauthRepository.saveClient({
      id: ids.next(),
      clientId: tokens.generate(),
      kind: 'dcr',
      name: clientName?.trim() || 'MCP client',
      redirectUris,
      createdAt: clock.now(),
    })
    logger.info('oauth client registered', { oauthClientId: client.id, name: client.name })
    return ok(client)
  }

export type RegisterOAuthClient = ReturnType<typeof registerOAuthClientFactory>
