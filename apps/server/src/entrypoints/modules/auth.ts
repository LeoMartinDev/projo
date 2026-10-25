import { adminAccountsFactory } from '../../application/account/admin-accounts.ts'
import { authenticateFactory } from '../../application/auth/authenticate.ts'
import { changePasswordFactory } from '../../application/auth/change-password.ts'
import { getMeFactory } from '../../application/auth/get-me.ts'
import { loginFactory } from '../../application/auth/login.ts'
import { openSessionFactory } from '../../application/auth/open-session.ts'
import { resolveProfileFactory } from '../../application/auth/resolve-profile.ts'
import { listSessionsFactory, revokeSessionFactory } from '../../application/auth/sessions.ts'
import { invitationsFactory } from '../../application/invitation/invitations.ts'
import { accountActionsFactory } from '../../application/profile/account-actions.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { isRestricted } from '../../core/profile/restrictions.ts'
import { settingKeys } from '../../core/settings/settings.ts'
import { createBunPasswordHasher } from '../../infrastructure/auth/bun-password-hasher.ts'
import { sessionTokens } from '../../infrastructure/auth/session-tokens.ts'
import { createInMemoryRateLimiter } from '../../infrastructure/rate-limit/in-memory-rate-limiter.ts'
import { createSqliteAccountActivity } from '../../infrastructure/sqlite/account-activity.ts'
import { createSqliteAccountRepository } from '../../infrastructure/sqlite/account-repository.ts'
import { createSqliteInvitationRepository } from '../../infrastructure/sqlite/invitation-repository.ts'
import { createSqliteProfileRepository } from '../../infrastructure/sqlite/profile-repository.ts'
import { createSqliteSessionRepository } from '../../infrastructure/sqlite/session-repository.ts'
import { createSqliteSettingsRepository } from '../../infrastructure/sqlite/settings-repository.ts'
import { createAuthMiddleware } from '../http/auth-middleware.ts'
import { adminAccountsRoutes } from '../http/routes/admin-accounts.ts'
import { authRoutes } from '../http/routes/auth.ts'
import { invitationsRoutes } from '../http/routes/invitations.ts'
import type { Platform } from './platform.ts'

/** §20: 10 login attempts per 15 min, per IP and per username (also: password changes). */
const loginRateLimit = { limit: 10, windowMs: 15 * 60_000 }
/** §20: 20 invitation acceptances per hour per IP. */
const invitationRateLimit = { limit: 20, windowMs: 60 * 60_000 }

/** Repositories and use cases shared by the auth, setup and profiles modules. */
export const buildAuthServices = ({ db, clock, ids }: Platform) => {
  const accountRepository = createSqliteAccountRepository({ db })
  const profileRepository = createSqliteProfileRepository({ db })
  const sessionRepository = createSqliteSessionRepository({ db })
  return {
    accountRepository,
    profileRepository,
    sessionRepository,
    passwordHasher: createBunPasswordHasher(),
    openSession: openSessionFactory({ sessionRepository, sessionTokens, clock, ids }),
    getMe: getMeFactory({ accountRepository, profileRepository }),
  }
}

/**
 * Wiring of auth: accounts, sessions, invitations (§14) and the admin account pages (§15).
 * `playbackSessions`: a deleted or disabled account's playback ends first (§10.6).
 * Also provides the API middleware that sets the `account` / `session` / `profileId` context
 * variables and closes non-public routes.
 */
export const buildAuthModule = (
  platform: Platform,
  { playbackSessions }: { playbackSessions: PlaybackSessionTerminator },
) => {
  const { db, clock, ids, logger, config } = platform
  const services = buildAuthServices(platform)
  const { accountRepository, profileRepository, sessionRepository, passwordHasher } = services
  const settingsRepository = createSqliteSettingsRepository({ db })

  const middleware = createAuthMiddleware({
    authenticate: authenticateFactory({
      accountRepository,
      sessionRepository,
      sessionTokens,
      clock,
    }),
    resolveProfile: resolveProfileFactory({ profileRepository, sessionRepository }),
    isRestrictedProfile: (profileId) => {
      const profile = profileRepository.findById(profileId)
      return profile !== undefined && isRestricted(profile)
    },
    ensureAccountActions: accountActionsFactory({ profileRepository }).ensureAllowed,
    clock,
    trustProxy: config.trustProxy,
  })

  const invitations = invitationsFactory({
    invitationRepository: createSqliteInvitationRepository({ db }),
    tokens: sessionTokens,
    passwordHasher,
    rateLimiter: createInMemoryRateLimiter({ ...invitationRateLimit, clock }),
    clock,
    ids,
    logger,
  })

  return {
    routes: authRoutes({
      login: loginFactory({
        accountRepository,
        profileRepository,
        passwordHasher,
        rateLimiter: createInMemoryRateLimiter({ ...loginRateLimit, clock }),
        openSession: services.openSession,
        logger,
      }),
      changePassword: changePasswordFactory({
        accountRepository,
        sessionRepository,
        passwordHasher,
        rateLimiter: createInMemoryRateLimiter({ ...loginRateLimit, clock }),
        clock,
        logger,
      }),
      getMe: services.getMe,
      openSession: services.openSession,
      listSessions: listSessionsFactory({ sessionRepository, clock }),
      revokeSession: revokeSessionFactory({ sessionRepository, clock, logger }),
      requireAccountActions: middleware.requireAccountActions,
      clock,
      trustProxy: config.trustProxy,
    }),
    invitationRoutes: invitationsRoutes({
      invitations,
      openSession: services.openSession,
      getMe: services.getMe,
      serverName: () => {
        const value = settingsRepository.get(settingKeys.serverName)
        return typeof value === 'string' ? value : undefined
      },
      clock,
      trustProxy: config.trustProxy,
    }),
    adminAccountRoutes: adminAccountsRoutes({
      accounts: adminAccountsFactory({
        accountRepository,
        profileRepository,
        sessionRepository,
        accountActivity: createSqliteAccountActivity({ db }),
        passwordHasher,
        playbackSessions,
        clock,
        ids,
        logger,
      }),
      invitations,
      clock,
    }),
    middleware,
  }
}
