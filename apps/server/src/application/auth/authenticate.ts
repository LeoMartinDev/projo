import { appError, err, type Result } from '@projo/shared'
import type { SessionKind } from '@projo/shared/api/auth'

import type { AccountRepository } from '../../core/auth/account.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import {
  type AdmittedSession,
  sessionAdmissionFactory,
  type SessionAdmissionError,
} from './shared/session-admission.ts'

type Deps = {
  accountRepository: AccountRepository
  sessionRepository: SessionRepository
  sessionTokens: SessionTokens
  clock: Clock
}

export type AuthenticateError = SessionAdmissionError

export type Authenticated = AdmittedSession

export const authenticateFactory = ({
  accountRepository,
  sessionRepository,
  sessionTokens,
  clock,
}: Deps) => {
  const admit = sessionAdmissionFactory({ accountRepository, sessionRepository, clock })
  return ({
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
    return admit(session)
  }
}

export type Authenticate = ReturnType<typeof authenticateFactory>
