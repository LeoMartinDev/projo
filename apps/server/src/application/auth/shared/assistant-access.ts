import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { AccountRepository } from '../../../core/auth/account.ts'
import {
  type AssistantToken,
  type AssistantTokenRepository,
  assistantTokenTouchIntervalMs,
} from '../../../core/auth/assistant-token.ts'
import type { Clock } from '../../../core/clock.ts'
import type { ProfileRepository } from '../../../core/profile/profile.ts'
import { isRestricted } from '../../../core/profile/restrictions.ts'

type Deps = {
  assistantTokenRepository: Pick<AssistantTokenRepository, 'touch'>
  accountRepository: Pick<AccountRepository, 'findById'>
  profileRepository: Pick<ProfileRepository, 'findById'>
  clock: Clock
}

export type AssistantPrincipal = { tokenId: string; accountId: string; profileId: string }

export type AssistantUnauthenticated = AppError<
  'auth/unauthenticated' | 'auth/session_revoked' | 'auth/account_disabled'
>
export type AssistantForbidden = AppError<'auth/forbidden' | 'auth/restricted_profile'>

export type AuthenticateAssistantError = AssistantUnauthenticated | AssistantForbidden

/**
 * Who may hold an assistant credential (an admin on an unrestricted profile of their own), and
 * the admission of a credential found by a token or an OAuth access token. Shared by the
 * assistant token and OAuth use cases.
 */
export const assistantAccessFactory = ({
  assistantTokenRepository,
  accountRepository,
  profileRepository,
  clock,
}: Deps) => {
  const administers = ({
    accountId,
    profileId,
  }: {
    accountId: string
    profileId: string
  }): Result<void, AuthenticateAssistantError> => {
    const account = accountRepository.findById(accountId)
    if (account === undefined) return err(appError('auth/unauthenticated', 'unknown account'))
    if (account.disabledAt !== undefined) {
      return err(
        appError('auth/account_disabled', 'account is disabled', {
          context: { accountId: account.id },
        }),
      )
    }
    if (account.role !== 'admin') return err(appError('auth/forbidden', 'admin role required'))
    const profile = profileRepository.findById(profileId)
    if (profile === undefined || profile.accountId !== accountId || isRestricted(profile)) {
      return err(
        appError('auth/restricted_profile', 'the assistant profile is restricted', {
          context: { profileId },
        }),
      )
    }
    return ok()
  }

  const authenticateAssistant = (
    found: AssistantToken,
  ): Result<AssistantPrincipal, AuthenticateAssistantError> => {
    if (found.revokedAt !== undefined) {
      return err(
        appError('auth/session_revoked', 'assistant revoked', {
          context: { assistantTokenId: found.id },
        }),
      )
    }
    const allowed = administers(found)
    if (!allowed.ok) return allowed
    const now = clock.now()
    if (
      found.lastUsedAt === undefined ||
      now.getTime() - found.lastUsedAt.getTime() >= assistantTokenTouchIntervalMs
    ) {
      assistantTokenRepository.touch({ id: found.id, lastUsedAt: now })
    }
    return ok({ tokenId: found.id, accountId: found.accountId, profileId: found.profileId })
  }

  return { administers, authenticateAssistant }
}

export type AssistantAccess = ReturnType<typeof assistantAccessFactory>
