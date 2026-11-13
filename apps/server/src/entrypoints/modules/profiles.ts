import { checkPinFactory } from '../../application/profile/check-pin.ts'
import { createAccountProfileFactory } from '../../application/profile/create-account-profile.ts'
import { createProfileFactory } from '../../application/profile/create-profile.ts'
import { deleteProfileFactory } from '../../application/profile/delete-profile.ts'
import { listLibraryAccessFactory } from '../../application/profile/list-library-access.ts'
import { listProfilesFactory } from '../../application/profile/list-profiles.ts'
import { selectProfileFactory } from '../../application/profile/select-profile.ts'
import { setLibraryAccessFactory } from '../../application/profile/set-library-access.ts'
import { updateProfileFactory } from '../../application/profile/update-profile.ts'
import { verifyProfilePinFactory } from '../../application/profile/verify-profile-pin.ts'
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
import type { AuthServices } from './auth.ts'
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
    authServices,
  }: {
    playbackSessions: PlaybackSessionTerminator
    visibilityScopes: VisibilityScopes
    authServices: AuthServices
  },
) => {
  const { db, clock, ids, logger } = platform
  const { accountRepository, profileRepository, sessionRepository, passwordHasher, getMe } =
    authServices

  const checkPin = checkPinFactory({
    passwordHasher,
    rateLimiter: createInMemoryRateLimiter({ ...pinRateLimit, clock }),
    logger,
  })
  const accountRole = (accountId: string) => accountRepository.findById(accountId)?.role
  const creation = { profileRepository, passwordHasher, clock, ids, logger }
  const libraryRepository = createSqliteLibraryRepository({ db })

  return defineModule({
    exposes: {
      routes: profilesRoutes({
        listProfiles: listProfilesFactory({ profileRepository }),
        createProfile: createProfileFactory(creation),
        updateProfile: updateProfileFactory({
          profileRepository,
          passwordHasher,
          checkPin,
          accountRole,
          profileChanged: scopes.invalidate,
          logger,
        }),
        deleteProfile: deleteProfileFactory({
          profileRepository,
          checkPin,
          playbackSessions,
          accountRole,
          profileChanged: scopes.invalidate,
          logger,
        }),
        verifyProfilePin: verifyProfilePinFactory({ profileRepository, checkPin }),
        selectProfile: selectProfileFactory({ profileRepository, sessionRepository, checkPin }),
        getMe,
      }),
      adminRoutes: adminProfilesRoutes({
        createAccountProfile: createAccountProfileFactory({ ...creation, accountRole }),
        listLibraryAccess: listLibraryAccessFactory({
          profileRepository,
          accountRepository,
          libraryRepository,
        }),
        setLibraryAccess: setLibraryAccessFactory({
          profileRepository,
          accountRepository,
          libraryRepository,
          profileChanged: scopes.invalidate,
          logger,
        }),
      }),
    },
  })
}
