import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { SessionKind } from '@projo/shared/api/auth'

import { type AccountRepository, toAuthAccount } from '../../core/auth/account.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { AuthAccount } from '../../core/auth/principal.ts'
import {
  type Session,
  sessionRefresh,
  type SessionRepository,
  sessionState,
} from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'

type Deps = {
  accountRepository: AccountRepository
  sessionRepository: SessionRepository
  sessionTokens: SessionTokens
  clock: Clock
}

export type AuthenticateError = AppError<
  'auth/unauthenticated' | 'auth/session_expired' | 'auth/session_revoked' | 'auth/account_disabled'
>

export type Authenticated = {
  account: AuthAccount
  session: Session
  /** The expiry was pushed back: a cookie must be re-sent with the new lifetime. */
  renewed: boolean
}

/**
 * Resolves a session token (cookie or bearer) into its account. Sliding expiry (§14): the
 * session is renewed for 30 days when the previous renewal is more than 24 h old.
 */
export const authenticateFactory =
  ({ accountRepository, sessionRepository, sessionTokens, clock }: Deps) =>
  ({
    token,
    kind,
  }: {
    token: string
    kind: SessionKind
  }): Result<Authenticated, AuthenticateError> => {
    const session = sessionRepository.findByTokenHash(sessionTokens.hash(token))
    if (session === undefined || session.kind !== kind) {
      return err(appError('auth/unauthenticated', 'unknown session'))
    }
    const now = clock.now()
    const state = sessionState(session, now)
    if (state === 'revoked') {
      return err(
        appError('auth/session_revoked', 'session revoked', { context: { sessionId: session.id } }),
      )
    }
    if (state === 'expired') {
      return err(
        appError('auth/session_expired', 'session expired', { context: { sessionId: session.id } }),
      )
    }
    const account = accountRepository.findById(session.accountId)
    if (account === undefined) return err(appError('auth/unauthenticated', 'unknown account'))
    if (account.disabledAt !== undefined) {
      return err(
        appError('auth/account_disabled', 'account is disabled', {
          context: { accountId: account.id },
        }),
      )
    }

    const refresh = sessionRefresh(session, now)
    if (refresh !== undefined) {
      sessionRepository.touch({
        id: session.id,
        lastSeenAt: refresh.lastSeenAt,
        expiresAt: refresh.expiresAt,
      })
    }
    return ok({
      account: toAuthAccount(account),
      session:
        refresh === undefined
          ? session
          : { ...session, lastSeenAt: refresh.lastSeenAt, expiresAt: refresh.expiresAt },
      renewed: refresh?.renewed ?? false,
    })
  }

export type Authenticate = ReturnType<typeof authenticateFactory>
