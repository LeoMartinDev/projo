import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { type AccountRepository, toAuthAccount } from '../../../core/auth/account.ts'
import type { AuthAccount } from '../../../core/auth/principal.ts'
import {
  type Session,
  sessionRefresh,
  type SessionRepository,
  sessionState,
} from '../../../core/auth/session.ts'
import type { Clock } from '../../../core/clock.ts'

type Deps = {
  accountRepository: Pick<AccountRepository, 'findById'>
  sessionRepository: Pick<SessionRepository, 'touch'>
  clock: Clock
}

export type SessionAdmissionError = AppError<
  'auth/unauthenticated' | 'auth/session_expired' | 'auth/session_revoked' | 'auth/account_disabled'
>

export type AdmittedSession = {
  account: AuthAccount
  session: Session
  renewed: boolean
}

/**
 * Admits a session found by a credential (its token, or a media key naming it): active, of an
 * enabled account; slides its expiry and touches it like any authenticated request.
 */
export const sessionAdmissionFactory =
  ({ accountRepository, sessionRepository, clock }: Deps) =>
  (session: Session): Result<AdmittedSession, SessionAdmissionError> => {
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
