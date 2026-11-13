import type { Pairing } from '../../../core/auth/pairing.ts'
import { type SessionRepository, sessionState } from '../../../core/auth/session.ts'

/** A pairing code lives only while the session that created it is active. */
export const isPairingCreatorActive = (
  sessionRepository: Pick<SessionRepository, 'findById'>,
  pairing: Pairing,
  now: Date,
): boolean => {
  const creator = sessionRepository.findById(pairing.createdBySessionId)
  return creator !== undefined && sessionState(creator, now) === 'active'
}
