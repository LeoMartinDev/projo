import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { AccountRepository } from '../../core/auth/account.ts'
import {
  type AssistantToken,
  type AssistantTokenRepository,
  assistantTokenTouchIntervalMs,
} from '../../core/auth/assistant-token.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'
import { isRestricted } from '../../core/profile/restrictions.ts'

type Deps = {
  assistantTokenRepository: AssistantTokenRepository
  accountRepository: Pick<AccountRepository, 'findById'>
  profileRepository: Pick<ProfileRepository, 'findById'>
  tokens: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type AssistantPrincipal = { tokenId: string; accountId: string; profileId: string }

export type AssistantUnauthenticated = AppError<
  'auth/unauthenticated' | 'auth/session_revoked' | 'auth/account_disabled'
>
export type AssistantForbidden = AppError<'auth/forbidden' | 'auth/restricted_profile'>

export type AuthenticateAssistantError = AssistantUnauthenticated | AssistantForbidden

export const assistantTokensFactory = ({
  assistantTokenRepository,
  accountRepository,
  profileRepository,
  tokens,
  clock,
  ids,
  logger,
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

  return {
    administers,
    authenticateAssistant,

    create: ({
      accountId,
      profileId,
      name,
    }: {
      accountId: string
      profileId: string
      name: string
    }): { token: string; assistant: AssistantToken } => {
      const token = tokens.generate()
      const assistant = assistantTokenRepository.create({
        id: ids.next(),
        accountId,
        profileId,
        kind: 'token',
        name,
        tokenHash: tokens.hash(token),
        createdAt: clock.now(),
      })
      logger.info('assistant token created', { accountId, assistantTokenId: assistant.id })
      return { token, assistant }
    },

    list: ({ accountId }: { accountId: string }): AssistantToken[] =>
      assistantTokenRepository.listActiveByAccount(accountId),

    revoke: ({
      id,
      accountId,
    }: {
      id: string
      accountId: string
    }): Result<void, AppError<'auth/assistant_token_not_found'>> => {
      if (!assistantTokenRepository.revoke({ id, accountId, revokedAt: clock.now() })) {
        return err(
          appError('auth/assistant_token_not_found', 'assistant token not found', {
            context: { id },
          }),
        )
      }
      logger.info('assistant token revoked', { accountId, assistantTokenId: id })
      return ok()
    },

    authenticate: (token: string): Result<AssistantPrincipal, AuthenticateAssistantError> => {
      const found = assistantTokenRepository.findByTokenHash(tokens.hash(token))
      if (found === undefined || found.kind !== 'token') {
        return err(appError('auth/unauthenticated', 'unknown token'))
      }
      return authenticateAssistant(found)
    },
  }
}

export type AssistantTokens = ReturnType<typeof assistantTokensFactory>
