import { createAccountFactory } from '../../application/account/create-account.ts'
import { deleteAccountFactory } from '../../application/account/delete-account.ts'
import { listAccountsFactory } from '../../application/account/list-accounts.ts'
import { resetAccountPasswordFactory } from '../../application/account/reset-account-password.ts'
import { revokeAccountSessionsFactory } from '../../application/account/revoke-account-sessions.ts'
import { updateAccountFactory } from '../../application/account/update-account.ts'
import { authenticateFactory } from '../../application/auth/authenticate.ts'
import { changePasswordFactory } from '../../application/auth/change-password.ts'
import { claimPairingFactory } from '../../application/auth/claim-pairing.ts'
import { createPairingFactory } from '../../application/auth/create-pairing.ts'
import { getMeFactory } from '../../application/auth/get-me.ts'
import { listSessionsFactory } from '../../application/auth/list-sessions.ts'
import { loginFactory } from '../../application/auth/login.ts'
import { openSessionFactory } from '../../application/auth/open-session.ts'
import { resolveProfileFactory } from '../../application/auth/resolve-profile.ts'
import { revokeSessionFactory } from '../../application/auth/revoke-session.ts'
import { acceptInvitationFactory } from '../../application/invitation/accept-invitation.ts'
import { checkInvitationFactory } from '../../application/invitation/check-invitation.ts'
import { createInvitationFactory } from '../../application/invitation/create-invitation.ts'
import { deleteInvitationFactory } from '../../application/invitation/delete-invitation.ts'
import { listInvitationsFactory } from '../../application/invitation/list-invitations.ts'
import { ensureAccountActionFactory } from '../../application/profile/ensure-account-action.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { isRestricted } from '../../core/profile/restrictions.ts'
import { settingKeys } from '../../core/settings/settings.ts'
import { createBunPasswordHasher } from '../../infrastructure/auth/bun-password-hasher.ts'
import { pairingCodes } from '../../infrastructure/auth/pairing-codes.ts'
import { sessionTokens } from '../../infrastructure/auth/session-tokens.ts'
import { createInMemoryRateLimiter } from '../../infrastructure/rate-limit/in-memory-rate-limiter.ts'
import { createSqliteAccountActivity } from '../../infrastructure/sqlite/account-activity.ts'
import { createSqliteAccountRepository } from '../../infrastructure/sqlite/account-repository.ts'
import { createSqliteInvitationRepository } from '../../infrastructure/sqlite/invitation-repository.ts'
import { createSqlitePairingRepository } from '../../infrastructure/sqlite/pairing-repository.ts'
import { createSqliteProfileRepository } from '../../infrastructure/sqlite/profile-repository.ts'
import { createSqliteSessionRepository } from '../../infrastructure/sqlite/session-repository.ts'
import { createSqliteSettingsRepository } from '../../infrastructure/sqlite/settings-repository.ts'
import { createAuthMiddleware } from '../http/auth-middleware.ts'
import { adminAccountsRoutes } from '../http/routes/admin-accounts.ts'
import { authRoutes } from '../http/routes/auth.ts'
import { invitationsRoutes } from '../http/routes/invitations.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

const loginRateLimit = { limit: 10, windowMs: 15 * 60_000 }
const pairingClaimRateLimit = { limit: 10, windowMs: 15 * 60_000 }
const invitationRateLimit = { limit: 20, windowMs: 60 * 60_000 }

const buildAuthServices = ({ db, clock, ids }: Platform) => {
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

/** Repositories and services the setup and profiles modules share with auth. */
export type AuthServices = ReturnType<typeof buildAuthServices>

export const buildAuthModule = (
  platform: Platform,
  { playbackSessions }: { playbackSessions: PlaybackSessionTerminator },
) => {
  const { db, clock, ids, logger, config, eventBus } = platform
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
    ensureAccountActions: ensureAccountActionFactory({ profileRepository }),
    clock,
    trustProxy: config.trustProxy,
  })

  const invitationRepository = createSqliteInvitationRepository({ db })
  const pairingRepository = createSqlitePairingRepository({ db })
  const adminAccountDeps = {
    accountRepository,
    profileRepository,
    sessionRepository,
    accountActivity: createSqliteAccountActivity({ db }),
    passwordHasher,
    playbackSessions,
    clock,
    ids,
    logger,
  }

  return defineModule({
    exposes: {
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
        createPairing: createPairingFactory({
          pairingRepository,
          sessionRepository,
          pairingCodes,
          clock,
          ids,
          logger,
        }),
        claimPairing: claimPairingFactory({
          pairingRepository,
          sessionRepository,
          pairingCodes,
          openSession: services.openSession,
          rateLimiter: createInMemoryRateLimiter({ ...pairingClaimRateLimit, clock }),
          eventBus,
          clock,
          logger,
        }),
        requireAccountActions: middleware.requireAccountActions,
        clock,
        trustProxy: config.trustProxy,
      }),
      invitationRoutes: invitationsRoutes({
        checkInvitation: checkInvitationFactory({
          invitationRepository,
          tokens: sessionTokens,
          clock,
        }),
        acceptInvitation: acceptInvitationFactory({
          invitationRepository,
          tokens: sessionTokens,
          passwordHasher,
          rateLimiter: createInMemoryRateLimiter({ ...invitationRateLimit, clock }),
          clock,
          ids,
          logger,
        }),
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
        listAccounts: listAccountsFactory(adminAccountDeps),
        createAccount: createAccountFactory(adminAccountDeps),
        updateAccount: updateAccountFactory(adminAccountDeps),
        deleteAccount: deleteAccountFactory(adminAccountDeps),
        resetAccountPassword: resetAccountPasswordFactory(adminAccountDeps),
        revokeAccountSessions: revokeAccountSessionsFactory(adminAccountDeps),
        listInvitations: listInvitationsFactory({ invitationRepository }),
        createInvitation: createInvitationFactory({
          invitationRepository,
          tokens: sessionTokens,
          clock,
          ids,
          logger,
        }),
        deleteInvitation: deleteInvitationFactory({ invitationRepository, logger }),
        clock,
      }),
      middleware,
      services,
    },
  })
}
