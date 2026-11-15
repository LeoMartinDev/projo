import { appError, err, type Result } from '@projo/shared'

import type { AccountRepository } from '../../core/auth/account.ts'
import { type MediaKeySigner, mediaKeyMessage, parseMediaKey } from '../../core/auth/media-key.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import {
  type AdmittedSession,
  sessionAdmissionFactory,
  type SessionAdmissionError,
} from './shared/session-admission.ts'

type Deps = {
  accountRepository: Pick<AccountRepository, 'findById'>
  sessionRepository: Pick<SessionRepository, 'findById' | 'touch'>
  mediaKeySigner: Pick<MediaKeySigner, 'verify'>
  clock: Clock
}

export type AuthenticateMediaKeyError = SessionAdmissionError

/** The bearer session a media key names, admitted like its token would be (§20). */
export const authenticateMediaKeyFactory = ({
  accountRepository,
  sessionRepository,
  mediaKeySigner,
  clock,
}: Deps) => {
  const admit = sessionAdmissionFactory({ accountRepository, sessionRepository, clock })
  return (key: string): Result<AdmittedSession, AuthenticateMediaKeyError> => {
    const parsed = parseMediaKey(key)
    if (
      parsed === undefined ||
      !mediaKeySigner.verify({
        message: mediaKeyMessage(parsed.sessionId),
        signature: parsed.signature,
      })
    ) {
      return err(appError('auth/unauthenticated', 'invalid media key'))
    }
    const session = sessionRepository.findById(parsed.sessionId)
    if (session === undefined || session.kind !== 'bearer') {
      return err(appError('auth/unauthenticated', 'unknown session'))
    }
    return admit(session)
  }
}

export type AuthenticateMediaKey = ReturnType<typeof authenticateMediaKeyFactory>
