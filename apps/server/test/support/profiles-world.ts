import type { AccountRole } from '@projo/shared/api/auth'

import { checkPinFactory } from '../../src/application/profile/check-pin.ts'
import { createAccountProfileFactory } from '../../src/application/profile/create-account-profile.ts'
import { createProfileFactory } from '../../src/application/profile/create-profile.ts'
import { deleteProfileFactory } from '../../src/application/profile/delete-profile.ts'
import { listProfilesFactory } from '../../src/application/profile/list-profiles.ts'
import { selectProfileFactory } from '../../src/application/profile/select-profile.ts'
import type { ProfileActor } from '../../src/application/profile/shared/profile-actor.ts'
import { updateProfileFactory } from '../../src/application/profile/update-profile.ts'
import { verifyProfilePinFactory } from '../../src/application/profile/verify-profile-pin.ts'
import { visibilityScopeFactory } from '../../src/application/profile/visibility-scope.ts'
import type { PlaybackScope } from '../../src/core/playback/session.ts'
import type { Profile } from '../../src/core/profile/profile.ts'
import {
  createCountingRateLimiter,
  createFakePasswordHasher,
  createInMemoryProfiles,
  createInMemorySessions,
  sampleProfile,
} from './auth.ts'
import { createManualClock } from './clock.ts'
import { createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'

/** The profile use cases on in-memory repositories, with the libraries films, series and anime. */
export const createProfilesWorld = (
  profiles: Profile[] = [sampleProfile()],
  roles: Record<string, AccountRole> = { 'account-1': 'user', 'account-2': 'user' },
) => {
  const clock = createManualClock()
  const store = createInMemoryProfiles(profiles, { libraryIds: ['films', 'series', 'anime'] })
  const sessions = createInMemorySessions()
  const { hasher } = createFakePasswordHasher()
  const rate = createCountingRateLimiter(5)
  const changed: string[] = []
  const endedPlayback: PlaybackScope[] = []
  const scopes = visibilityScopeFactory({ profileRepository: store.repository, clock })
  const deps = {
    profileRepository: store.repository,
    sessionRepository: sessions.repository,
    passwordHasher: hasher,
    checkPin: checkPinFactory({
      passwordHasher: hasher,
      rateLimiter: rate.limiter,
      logger: silentLogger,
    }),
    playbackSessions: { endWithin: (scope: PlaybackScope) => void endedPlayback.push(scope) },
    accountRole: (accountId: string) => roles[accountId],
    profileChanged: (id: string) => {
      changed.push(id)
      scopes.invalidate(id)
    },
    clock,
    ids: createSequentialIds('new-profile-'),
    logger: silentLogger,
  }
  return {
    clock,
    store,
    sessions,
    rate,
    changed,
    endedPlayback,
    scopes,
    listProfiles: listProfilesFactory(deps),
    createProfile: createProfileFactory(deps),
    createAccountProfile: createAccountProfileFactory(deps),
    updateProfile: updateProfileFactory(deps),
    deleteProfile: deleteProfileFactory(deps),
    verifyProfilePin: verifyProfilePinFactory(deps),
    selectProfile: selectProfileFactory(deps),
  }
}

export const admin: ProfileActor = {
  accountId: 'account-1',
  role: 'admin',
  sessionId: 's1',
  activeProfileId: 'profile-1',
}
export const user: ProfileActor = { ...admin, role: 'user' }

export const kid = sampleProfile({
  id: 'kid',
  name: 'Enfants',
  libraryAccess: 'selected',
  libraryIds: ['anime'],
  maxContentRating: '10',
  avatarColor: 'violet',
})
export const locked = sampleProfile({ id: 'parent', name: 'Parent', pinHash: 'hashed:1234' })
