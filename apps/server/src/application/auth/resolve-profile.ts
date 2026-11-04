import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Session, SessionRepository } from '../../core/auth/session.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'

type Deps = {
  profileRepository: ProfileRepository
  sessionRepository: SessionRepository
}

export type ResolveProfileError = AppError<'profile/forbidden' | 'profile/pin_required'>

export const resolveProfileFactory =
  ({ profileRepository, sessionRepository }: Deps) =>
  ({
    session,
    requestedProfileId,
  }: {
    session: Session
    requestedProfileId: string | undefined
  }): Result<string | undefined, ResolveProfileError> => {
    if (requestedProfileId !== undefined) {
      const profile = profileRepository.findById(requestedProfileId)
      if (profile === undefined || profile.accountId !== session.accountId) {
        return err(
          appError('profile/forbidden', 'profile does not belong to the account', {
            context: { profileId: requestedProfileId },
          }),
        )
      }
      if (session.lastProfileId === profile.id) return ok(profile.id)
      if (
        profile.pinHash !== undefined &&
        profileRepository.listByAccount(session.accountId).length > 1
      ) {
        return err(
          appError('profile/pin_required', 'this profile is locked by a PIN', {
            context: { profileId: profile.id },
          }),
        )
      }
      sessionRepository.setLastProfile({ id: session.id, profileId: profile.id })
      return ok(profile.id)
    }
    const profiles = profileRepository.listByAccount(session.accountId)
    if (profiles.length === 1) return ok(profiles[0]?.id)
    return ok(profiles.find((profile) => profile.id === session.lastProfileId)?.id)
  }

export type ResolveProfile = ReturnType<typeof resolveProfileFactory>
