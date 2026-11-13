import { ok, type Result } from '@projo/shared'

import type { ProfileRepository } from '../../core/profile/profile.ts'
import { type AccountActionError, actingProfile, restrictedActor } from './shared/acting-profile.ts'

type Deps = { profileRepository: Pick<ProfileRepository, 'findById' | 'listByAccount'> }

export const ensureAccountActionFactory =
  ({ profileRepository }: Deps) =>
  (actor: {
    accountId: string
    activeProfileId: string | undefined
  }): Result<void, AccountActionError> =>
    actingProfile(profileRepository, actor).restricted ? restrictedActor() : ok()

export type EnsureAccountAction = ReturnType<typeof ensureAccountActionFactory>
