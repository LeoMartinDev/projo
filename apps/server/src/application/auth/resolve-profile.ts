import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Session, SessionRepository } from '../../core/auth/session.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'

type Deps = {
  profileRepository: ProfileRepository
  sessionRepository: SessionRepository
}

export type ResolveProfileError = AppError<'profile/forbidden' | 'profile/pin_required'>

/**
 * Active profile of a request (§17.1, §13.6): `X-Profile-Id` when it belongs to the account
 * (remembered as the session's last profile), else the only profile of the account, else the
 * last profile used by this session. `undefined` when the client has to choose ("Who's watching?").
 *
 * A PIN-protected profile is accepted in `X-Profile-Id` only once this session unlocked it
 * (`POST /profiles/:id/select` with the PIN made it the session's last profile): switching to it
 * asks for the PIN every time (§13.6), and the header alone cannot bypass it.
 */
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
