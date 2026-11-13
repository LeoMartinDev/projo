import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  type ClientMetadataFetcher,
  grantedScope,
  isAcceptableRedirectUri,
  type OAuthClient,
  oauthLifetimes,
  type OAuthRepository,
  redirectUriMatches,
  resourceMatches,
} from '../../../core/auth/oauth.ts'
import type { Clock } from '../../../core/clock.ts'
import type { IdGenerator } from '../../../core/ids.ts'

export type AuthorizationRequest = {
  responseType: string
  clientId: string
  redirectUri: string
  state?: string
  codeChallenge: string
  codeChallengeMethod: string
  scope?: string
  resource?: string
}

export type ConsentError = AppError<
  'oauth/invalid_client' | 'oauth/invalid_redirect_uri' | 'oauth/invalid_request'
>

export type OAuthRequestDeps = {
  oauthRepository: Pick<OAuthRepository, 'findClient' | 'saveClient'>
  clientMetadata: ClientMetadataFetcher
  clock: Clock
  ids: IdGenerator
}

const resolveClient = async (
  { oauthRepository, clientMetadata, clock, ids }: OAuthRequestDeps,
  clientId: string,
): Promise<Result<OAuthClient, AppError<'oauth/invalid_client'>>> => {
  const known = oauthRepository.findClient(clientId)
  const now = clock.now()
  if (!/^https?:\/\//.test(clientId)) {
    return known === undefined
      ? err(appError('oauth/invalid_client', 'unknown client', { context: { clientId } }))
      : ok(known)
  }
  if (
    known?.fetchedAt !== undefined &&
    now.getTime() - known.fetchedAt.getTime() < oauthLifetimes.clientMetadataMs
  ) {
    return ok(known)
  }
  const document = await clientMetadata(clientId)
  if (!document.ok) return document
  const redirectUris = document.value.redirectUris.filter(isAcceptableRedirectUri)
  return ok(
    oauthRepository.saveClient({
      id: known?.id ?? ids.next(),
      clientId,
      kind: 'cimd',
      name: document.value.name ?? new URL(clientId).hostname,
      redirectUris,
      createdAt: known?.createdAt ?? now,
      fetchedAt: now,
      ...(known?.lastUsedAt === undefined ? {} : { lastUsedAt: known.lastUsedAt }),
    }),
  )
}

/** The checks of an authorization request shared by the consent screen and the decision. */
export const checkAuthorizationRequest = async (
  deps: OAuthRequestDeps,
  request: AuthorizationRequest,
  mcpUrl: string,
): Promise<Result<{ client: OAuthClient; scope: string }, ConsentError>> => {
  const client = await resolveClient(deps, request.clientId)
  if (!client.ok) return client
  if (!client.value.redirectUris.some((uri) => redirectUriMatches(uri, request.redirectUri))) {
    return err(
      appError('oauth/invalid_redirect_uri', 'redirect_uri is not one of the client', {
        context: { clientId: request.clientId },
      }),
    )
  }
  const invalid = (reason: string) =>
    err(appError('oauth/invalid_request', reason, { context: { reason } }))
  if (request.responseType !== 'code') return invalid('response_type must be code')
  if (request.codeChallengeMethod !== 'S256') return invalid('PKCE S256 is required')
  if (!resourceMatches(request.resource, mcpUrl)) return invalid('unknown resource')
  return ok({ client: client.value, scope: grantedScope(request.scope) })
}
