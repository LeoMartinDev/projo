import { libraryAccessFactory } from '../../application/profile/library-access.ts'
import { checkPinFactory } from '../../application/profile/pin.ts'
import { profilesFactory } from '../../application/profile/profiles.ts'
import { visibilityScopeFactory } from '../../application/profile/visibility-scope.ts'
import type { VisibilityScopeResolver } from '../../core/catalog/catalog.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { createInMemoryRateLimiter } from '../../infrastructure/rate-limit/in-memory-rate-limiter.ts'
import { createSqliteLibraryRepository } from '../../infrastructure/sqlite/library-repository.ts'
import { adminProfilesRoutes } from '../http/routes/admin-profiles.ts'
import { profilesRoutes } from '../http/routes/profiles.ts'
import { buildAuthServices } from './auth.ts'
import type { Platform } from './platform.ts'

/** §20: 5 PIN checks per minute per profile. */
const pinRateLimit = { limit: 5, windowMs: 60_000 }

/**
 * Wiring of the profiles domain (§13.6, §14): `/profiles` routes, the admin routes that manage
 * profiles from an account or a library (`/admin/accounts/:id/profiles`,
 * `/admin/libraries/:id/profiles`), and `visibilityScope`, the `VisibilityScopeResolver` the
 * catalogue, progress and playback modules filter with (library access + maximum rating of a
 * profile; cached 10 s, dropped at once when the profile changes). `playbackSessions`: a deleted
 * profile's playback ends first (§10.6).
 */
export const buildProfilesModule = (
  platform: Platform,
  { playbackSessions }: { playbackSessions: PlaybackSessionTerminator },
) => {
  const { db, clock, ids, logger } = platform
  const { accountRepository, profileRepository, sessionRepository, passwordHasher, getMe } =
    buildAuthServices(platform)
  const scopes = visibilityScopeFactory({ profileRepository, clock })
  const visibilityScope: VisibilityScopeResolver = scopes.resolve

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
    accountExists: (accountId) => accountRepository.findById(accountId) !== undefined,
    profileChanged: scopes.invalidate,
    clock,
    ids,
    logger,
  })

  return {
    visibilityScope,
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
  }
}
