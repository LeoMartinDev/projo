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

/** Who an assistant token acts as (§27.3), checked again on every MCP request. */
export type AssistantPrincipal = { tokenId: string; accountId: string; profileId: string }

/** 401: no usable token. */
export type AssistantUnauthenticated = AppError<
  'auth/unauthenticated' | 'auth/session_revoked' | 'auth/account_disabled'
>
/** 403: the token is fine, but its account or profile may no longer administer. */
export type AssistantForbidden = AppError<'auth/forbidden' | 'auth/restricted_profile'>

export type AuthenticateAssistantError = AssistantUnauthenticated | AssistantForbidden

/**
 * Assistant tokens of the MCP server (§27.3): created by an admin from an unrestricted profile
 * (the `/admin/*` guard), shown once, accepted on `/mcp` only, valid until revoked.
 */
export const assistantTokensFactory = ({
  assistantTokenRepository,
  accountRepository,
  profileRepository,
  tokens,
  clock,
  ids,
  logger,
}: Deps) => {
  /** An enabled admin on an unrestricted profile of its own (§15): who may use an assistant. */
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

  /**
   * A live assistant → its principal, checked again on every MCP request: a demoted admin or a
   * profile given restrictions keeps its assistants but cannot use them.
   */
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

    /** `Authorization: Bearer` of `/mcp` with a token created in the admin (§27.3). */
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
