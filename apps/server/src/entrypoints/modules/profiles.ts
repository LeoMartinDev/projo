import { libraryAccessFactory } from '../../application/profile/library-access.ts'
import { checkPinFactory } from '../../application/profile/pin.ts'
import { profilesFactory } from '../../application/profile/profiles.ts'
import {
  type VisibilityScopes,
  visibilityScopeFactory,
} from '../../application/profile/visibility-scope.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { createInMemoryRateLimiter } from '../../infrastructure/rate-limit/in-memory-rate-limiter.ts'
import { createSqliteLibraryRepository } from '../../infrastructure/sqlite/library-repository.ts'
import { createSqliteProfileRepository } from '../../infrastructure/sqlite/profile-repository.ts'
import { adminProfilesRoutes } from '../http/routes/admin-profiles.ts'
import { profilesRoutes } from '../http/routes/profiles.ts'
import { buildAuthServices } from './auth.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

const pinRateLimit = { limit: 5, windowMs: 60_000 }

/**
 * What each profile may see (§14), cached per profile. Built before every module: catalog,
 * playback, progress… resolve through it (`resolve`, the `visibilityScope` they take), and the
 * profiles module invalidates it when a profile changes.
 */
export const buildVisibilityScopes = ({ db, clock }: Platform): VisibilityScopes =>
  visibilityScopeFactory({ profileRepository: createSqliteProfileRepository({ db }), clock })

export const buildProfilesModule = (
  platform: Platform,
  {
    playbackSessions,
    visibilityScopes: scopes,
  }: { playbackSessions: PlaybackSessionTerminator; visibilityScopes: VisibilityScopes },
) => {
  const { db, clock, ids, logger } = platform
  const { accountRepository, profileRepository, sessionRepository, passwordHasher, getMe } =
    buildAuthServices(platform)

  const profiles = profilesFactory({
    profileRepository,
    sessionRepository,
    passwordHasher,
    checkPin: checkPinFactory({
      passwordHasher,
      rateLimiter: createInMemoryRateLimiter({ ...pinRateLimit, clock }),
      logger,
    }),
    playbackSessions,
    accountRole: (accountId) => accountRepository.findById(accountId)?.role,
    profileChanged: scopes.invalidate,
    clock,
    ids,
    logger,
  })

  return defineModule({
    exposes: {
      routes: profilesRoutes({ profiles, getMe }),
      adminRoutes: adminProfilesRoutes({
        profiles,
        libraryAccess: libraryAccessFactory({
          profileRepository,
          accountRepository,
          libraryRepository: createSqliteLibraryRepository({ db }),
          profileChanged: scopes.invalidate,
          logger,
        }),
      }),
    },
  })
}
