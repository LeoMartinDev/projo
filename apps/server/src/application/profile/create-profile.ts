import type { Result } from '@projo/shared'

import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'
import { restrictedActor } from './shared/acting-profile.ts'
import { actingAs, type ProfileActor } from './shared/profile-actor.ts'
import {
  type CreateProfileError,
  type CreateProfileInput,
  createProfileInAccount,
  type ProfileCreationDeps,
} from './shared/profile-creation.ts'

type Deps = Omit<ProfileCreationDeps, 'profileRepository'> & {
  profileRepository: ProfileCreationDeps['profileRepository'] & Pick<ProfileRepository, 'findById'>
}

export const createProfileFactory =
  (deps: Deps) =>
  ({
    actor,
    input,
  }: {
    actor: ProfileActor
    input: CreateProfileInput
  }): Promise<Result<Profile, CreateProfileError>> => {
    const acting = actingAs(deps.profileRepository, actor)
    if (acting.restricted) return Promise.resolve(restrictedActor())
    return createProfileInAccount(deps, {
      accountId: actor.accountId,
      ceiling: acting.effective,
      input,
    })
  }

export type CreateProfile = ReturnType<typeof createProfileFactory>
