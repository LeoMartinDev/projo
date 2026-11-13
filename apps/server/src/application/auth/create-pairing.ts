import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  maxLivePairingsPerAccount,
  type Pairing,
  type PairingCodes,
  pairingLifetimeMs,
  type PairingRepository,
  pairingRetentionMs,
  pairingState,
} from '../../core/auth/pairing.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import { isPairingCreatorActive } from './shared/pairing-creator.ts'

type Deps = {
  pairingRepository: PairingRepository
  sessionRepository: Pick<SessionRepository, 'findById'>
  pairingCodes: PairingCodes
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type CreatePairingError = AppError<'auth/pairing_limit_reached'>

const maxCodeDraws = 5

export const createPairingFactory = ({
  pairingRepository,
  sessionRepository,
  pairingCodes,
  clock,
  ids,
  logger,
}: Deps) => {
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

  return ({
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
      .filter((pairing) => isPairingCreatorActive(sessionRepository, pairing, now))
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
}

export type CreatePairing = ReturnType<typeof createPairingFactory>
