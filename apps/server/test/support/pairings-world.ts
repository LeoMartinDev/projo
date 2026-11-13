import { claimPairingFactory } from '../../src/application/auth/claim-pairing.ts'
import { createPairingFactory } from '../../src/application/auth/create-pairing.ts'
import { openSessionFactory } from '../../src/application/auth/open-session.ts'
import {
  createCountingRateLimiter,
  createFakePairingCodes,
  createFakeSessionTokens,
  createInMemoryPairings,
  createInMemorySessions,
} from './auth.ts'
import { createManualClock } from './clock.ts'
import { createRecordingEventBus, createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'

/** The pairing use cases on in-memory repositories, with a browser session that creates codes. */
export const createPairingsWorld = ({ codes = [] }: { codes?: string[] } = {}) => {
  const clock = createManualClock()
  const sessionStore = createInMemorySessions()
  const sessionRepository = sessionStore.repository
  const pairingStore = createInMemoryPairings()
  const rate = createCountingRateLimiter(10)
  const recording = createRecordingEventBus()
  const openSession = openSessionFactory({
    sessionRepository,
    sessionTokens: createFakeSessionTokens(),
    clock,
    ids: createSequentialIds('session-'),
  })
  const creator = openSession({
    accountId: 'account-1',
    kind: 'cookie',
    deviceName: 'Firefox · macOS',
    userAgent: 'Firefox',
  }).session
  const pairingCodes = createFakePairingCodes(codes)
  return {
    clock,
    rate,
    creator,
    openSession,
    sessionRepository,
    sessions: sessionStore.sessions,
    pairings: pairingStore.pairings,
    events: recording.events,
    create: createPairingFactory({
      pairingRepository: pairingStore.repository,
      sessionRepository,
      pairingCodes,
      clock,
      ids: createSequentialIds('pairing-'),
      logger: silentLogger,
    }),
    claim: claimPairingFactory({
      pairingRepository: pairingStore.repository,
      sessionRepository,
      pairingCodes,
      openSession,
      rateLimiter: rate.limiter,
      eventBus: recording.bus,
      clock,
      logger: silentLogger,
    }),
  }
}

export const claimInput = {
  deviceName: 'iPhone 15 Pro',
  ip: '10.0.0.2',
  userAgent: 'projo/1.0 iOS',
}

export const created = (t: ReturnType<typeof createPairingsWorld>) => {
  const result = t.create({ accountId: 'account-1', sessionId: t.creator.id })
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}
