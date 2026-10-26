import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  isWellFormedPairingCode,
  maxLivePairingsPerAccount,
  normalizePairingCode,
  type Pairing,
  type PairingCodes,
  pairingLifetimeMs,
  type PairingRepository,
  pairingRetentionMs,
  pairingState,
} from '../../core/auth/pairing.ts'
import type { RateLimiter } from '../../core/auth/ports.ts'
import { type Session, type SessionRepository, sessionState } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { OpenSession } from './open-session.ts'

type Deps = {
  pairingRepository: PairingRepository
  sessionRepository: SessionRepository
  pairingCodes: PairingCodes
  openSession: OpenSession
  /** §14: 10 claim attempts per 15 min per IP. */
  rateLimiter: RateLimiter
  eventBus: EventBus
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type CreatePairingError = AppError<'auth/pairing_limit_reached'>

export type ClaimPairingError = AppError<
  'auth/rate_limited' | 'auth/pairing_invalid' | 'auth/pairing_expired' | 'auth/pairing_used'
>

export const pairingClaimRateLimitKey = (ip: string) => `pairing:ip:${ip}`

/** A fresh code could collide with a live one: drawn again, at most this many times. */
const maxCodeDraws = 5

/**
 * §14 "Pairing a device". `create`: a code for the signed-in account, tied to the session that
 * asked for it (revoking that session voids it). `claim`: the app trades the code for a bearer
 * session of that account, once; the creating session is told through `pairing.claimed`.
 * Both are synchronous: checking and writing with no `await` in between keeps two claims of one
 * code from both passing.
 */
export const pairingsFactory = ({
  pairingRepository,
  sessionRepository,
  pairingCodes,
  openSession,
  rateLimiter,
  eventBus,
  clock,
  ids,
  logger,
}: Deps) => {
  const creatorActive = (pairing: Pairing, now: Date): boolean => {
    const creator = sessionRepository.findById(pairing.createdBySessionId)
    return creator !== undefined && sessionState(creator, now) === 'active'
  }

  /** A code no live pairing holds, with its hash. */
  const drawCode = (now: Date): { code: string; codeHash: string } => {
    for (let draw = 1; ; draw += 1) {
      const code = pairingCodes.generate()
      const codeHash = pairingCodes.hash(code)
      const holder = pairingRepository.findByCodeHash(codeHash)
      const taken =
        holder !== undefined && pairingState(holder, { now, creatorActive: true }) === 'live'
      if (!taken || draw >= maxCodeDraws) return { code, codeHash }
    }
  }

  const create = ({
    accountId,
    sessionId,
  }: {
    accountId: string
    sessionId: string
  }): Result<{ pairing: Pairing; code: string }, CreatePairingError> => {
    const now = clock.now()
    pairingRepository.deleteExpiredBefore(new Date(now.getTime() - pairingRetentionMs))
    const live = pairingRepository
      .listLiveByAccount({ accountId, now })
      .filter((pairing) => creatorActive(pairing, now))
    if (live.length >= maxLivePairingsPerAccount) {
      return err(
        appError('auth/pairing_limit_reached', 'too many pairing codes waiting to be claimed', {
          context: { limit: maxLivePairingsPerAccount },
        }),
      )
    }
    const { code, codeHash } = drawCode(now)
    const pairing: Pairing = {
      id: ids.next(),
      accountId,
      createdBySessionId: sessionId,
      codeHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + pairingLifetimeMs),
    }
    pairingRepository.create(pairing)
    logger.info('pairing code created', { accountId, sessionId, pairingId: pairing.id })
    return ok({ pairing, code })
  }

  const claim = ({
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
    switch (pairingState(pairing, { now, creatorActive: creatorActive(pairing, now) })) {
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

  return { create, claim }
}

export type Pairings = ReturnType<typeof pairingsFactory>
