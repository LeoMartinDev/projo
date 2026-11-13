import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  isWellFormedPairingCode,
  normalizePairingCode,
  type PairingCodes,
  type PairingRepository,
  pairingState,
} from '../../core/auth/pairing.ts'
import type { RateLimiter } from '../../core/auth/ports.ts'
import type { Session, SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'
import type { OpenSession } from './open-session.ts'
import { isPairingCreatorActive } from './shared/pairing-creator.ts'

type Deps = {
  pairingRepository: Pick<PairingRepository, 'findByCodeHash' | 'claim'>
  sessionRepository: Pick<SessionRepository, 'findById' | 'revoke'>
  pairingCodes: PairingCodes
  openSession: OpenSession
  rateLimiter: RateLimiter
  eventBus: EventBus
  clock: Clock
  logger: Logger
}

export type ClaimPairingError = AppError<
  'auth/rate_limited' | 'auth/pairing_invalid' | 'auth/pairing_expired' | 'auth/pairing_used'
>

export const pairingClaimRateLimitKey = (ip: string) => `pairing:ip:${ip}`

export const claimPairingFactory =
  ({
    pairingRepository,
    sessionRepository,
    pairingCodes,
    openSession,
    rateLimiter,
    eventBus,
    clock,
    logger,
  }: Deps) =>
  ({
    code,
    deviceName,
    ip,
    userAgent,
  }: {
    code: string
    deviceName: string
    ip: string
    userAgent: string
  }): Result<{ token: string; session: Session }, ClaimPairingError> => {
    const key = pairingClaimRateLimitKey(ip)
    const retryAfterMs = rateLimiter.blockedFor(key)
    if (retryAfterMs !== undefined) {
      logger.warn('pairing claim rate limited', { code: 'auth/rate_limited', ip })
      return err(
        appError('auth/rate_limited', 'too many pairing attempts', {
          context: { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
        }),
      )
    }
    rateLimiter.hit(key)

    const normalized = normalizePairingCode(code)
    const invalid = () => {
      logger.info('pairing claim refused', { code: 'auth/pairing_invalid', ip })
      return err(appError('auth/pairing_invalid', 'unknown pairing code'))
    }
    if (!isWellFormedPairingCode(normalized)) return invalid()
    const pairing = pairingRepository.findByCodeHash(pairingCodes.hash(normalized))
    if (pairing === undefined) return invalid()

    const now = clock.now()
    switch (
      pairingState(pairing, {
        now,
        creatorActive: isPairingCreatorActive(sessionRepository, pairing, now),
      })
    ) {
      case 'voided':
        return invalid()
      case 'claimed':
        return err(
          appError('auth/pairing_used', 'pairing code already used', {
            context: { pairingId: pairing.id },
          }),
        )
      case 'expired':
        return err(
          appError('auth/pairing_expired', 'pairing code expired', {
            context: { pairingId: pairing.id },
          }),
        )
      case 'live':
        break
    }

    const { token, session } = openSession({
      accountId: pairing.accountId,
      kind: 'bearer',
      deviceName,
      userAgent,
    })
    if (
      !pairingRepository.claim({ id: pairing.id, claimedAt: now, claimedSessionId: session.id })
    ) {
      sessionRepository.revoke({ id: session.id, revokedAt: now })
      return err(
        appError('auth/pairing_used', 'pairing code already used', {
          context: { pairingId: pairing.id },
        }),
      )
    }
    eventBus.publish('pairing.claimed', {
      pairingId: pairing.id,
      sessionId: pairing.createdBySessionId,
      deviceSessionId: session.id,
      deviceName: session.deviceName,
    })
    logger.info('pairing code claimed', {
      accountId: pairing.accountId,
      pairingId: pairing.id,
      sessionId: session.id,
    })
    return ok({ token, session })
  }

export type ClaimPairing = ReturnType<typeof claimPairingFactory>
