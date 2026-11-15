import { authenticateFactory } from '../../src/application/auth/authenticate.ts'
import { authenticateMediaKeyFactory } from '../../src/application/auth/authenticate-media-key.ts'
import { getMeFactory } from '../../src/application/auth/get-me.ts'
import { issueMediaKeyFactory } from '../../src/application/auth/issue-media-key.ts'
import { listSessionsFactory } from '../../src/application/auth/list-sessions.ts'
import { loginFactory } from '../../src/application/auth/login.ts'
import { openSessionFactory } from '../../src/application/auth/open-session.ts'
import { resolveProfileFactory } from '../../src/application/auth/resolve-profile.ts'
import { revokeSessionFactory } from '../../src/application/auth/revoke-session.ts'
import {
  createCountingRateLimiter,
  createFakeMediaKeySigner,
  createFakePasswordHasher,
  createFakeSessionTokens,
  createInMemoryAccounts,
  createInMemoryProfiles,
  createInMemorySessions,
  sampleAccount,
  sampleProfile,
} from './auth.ts'
import { createManualClock } from './clock.ts'
import { createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'

/** The session use cases (login, authenticate, profiles of a session…) on in-memory repositories. */
export const createAuthWorld = ({
  accounts = [sampleAccount()],
  profiles = [sampleProfile()],
}: {
  accounts?: ReturnType<typeof sampleAccount>[]
  profiles?: ReturnType<typeof sampleProfile>[]
} = {}) => {
  const clock = createManualClock()
  const accountRepository = createInMemoryAccounts(accounts).repository
  const profileRepository = createInMemoryProfiles(profiles).repository
  const sessionStore = createInMemorySessions()
  const sessionRepository = sessionStore.repository
  const sessionTokens = createFakeSessionTokens()
  const { hasher, calls } = createFakePasswordHasher()
  const rate = createCountingRateLimiter(10)
  const mediaKeySigner = createFakeMediaKeySigner()
  const openSession = openSessionFactory({
    sessionRepository,
    sessionTokens,
    clock,
    ids: createSequentialIds('session-'),
  })
  return {
    clock,
    calls,
    rate,
    sessions: sessionStore.sessions,
    sessionRepository,
    openSession,
    login: loginFactory({
      accountRepository,
      profileRepository,
      passwordHasher: hasher,
      rateLimiter: rate.limiter,
      openSession,
      logger: silentLogger,
    }),
    authenticate: authenticateFactory({
      accountRepository,
      sessionRepository,
      sessionTokens,
      clock,
    }),
    issueMediaKey: issueMediaKeyFactory({ mediaKeySigner }),
    authenticateMediaKey: authenticateMediaKeyFactory({
      accountRepository,
      sessionRepository,
      mediaKeySigner,
      clock,
    }),
    resolveProfile: resolveProfileFactory({ profileRepository, sessionRepository }),
    getMe: getMeFactory({ accountRepository, profileRepository }),
    listSessions: listSessionsFactory({ sessionRepository, clock }),
    revokeSession: revokeSessionFactory({ sessionRepository, clock, logger: silentLogger }),
  }
}
