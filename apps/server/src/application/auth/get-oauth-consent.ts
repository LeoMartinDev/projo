import { ok, type Result } from '@projo/shared'

import { isLoopbackRedirectUri } from '../../core/auth/oauth.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'
import type { AssistantAccess } from './shared/assistant-access.ts'
import {
  type AuthorizationRequest,
  checkAuthorizationRequest,
  type ConsentError,
  type OAuthRequestDeps,
} from './shared/oauth-request.ts'

type Deps = OAuthRequestDeps & {
  assistantAccess: Pick<AssistantAccess, 'administers'>
  profileRepository: Pick<ProfileRepository, 'findById'>
}

export type OAuthConsent = {
  client: { name: string; redirectHost: string; loopback: boolean }
  canAuthorize: boolean
  profile?: { id: string; name: string }
}

export const getOAuthConsentFactory =
  (deps: Deps) =>
  async ({
    request,
    mcpUrl,
    accountId,
    profileId,
  }: {
    request: AuthorizationRequest
    mcpUrl: string
    accountId: string
    profileId: string | undefined
  }): Promise<Result<OAuthConsent, ConsentError>> => {
    const { assistantAccess, profileRepository } = deps
    const checked = await checkAuthorizationRequest(deps, request, mcpUrl)
    if (!checked.ok) return checked
    const profile = profileId === undefined ? undefined : profileRepository.findById(profileId)
    const canAuthorize =
      profile !== undefined && assistantAccess.administers({ accountId, profileId: profile.id }).ok
    return ok({
      client: {
        name: checked.value.client.name,
        redirectHost: new URL(request.redirectUri).host,
        loopback: isLoopbackRedirectUri(request.redirectUri),
      },
      canAuthorize,
      ...(profile === undefined ? {} : { profile: { id: profile.id, name: profile.name } }),
    })
  }

export type GetOAuthConsent = ReturnType<typeof getOAuthConsentFactory>
