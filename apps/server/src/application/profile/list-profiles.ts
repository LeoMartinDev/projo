import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'

type Deps = { profileRepository: Pick<ProfileRepository, 'listByAccount'> }

export const listProfilesFactory =
  ({ profileRepository }: Deps) =>
  ({ accountId }: { accountId: string }): Profile[] =>
    profileRepository.listByAccount(accountId)

export type ListProfiles = ReturnType<typeof listProfilesFactory>
