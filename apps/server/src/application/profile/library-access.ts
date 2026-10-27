import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { removesLastUnrestricted } from '../../core/account/last-admin.ts'
import type { AccountRepository } from '../../core/auth/account.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'

type Deps = {
  profileRepository: Pick<ProfileRepository, 'listByAccount' | 'update'>
  accountRepository: Pick<AccountRepository, 'list'>
  libraryRepository: Pick<LibraryRepository, 'list' | 'findById'>
  /** Called after any change of a profile (cached visibility scopes). */
  profileChanged: (profileId: string) => void
  logger: Logger
}

/** A profile as "Profiles with access" shows it (§14, §15 Libraries). */
export type LibraryProfileAccess = {
  profile: Profile
  username: string
  /** Sees the library: `library_access = all`, or the library is among its `profile_libraries`. */
  hasAccess: boolean
}

export type LibraryAccessError = AppError<
  'library/not_found' | 'profile/not_found' | 'profile/last_unrestricted'
>

const sees = (profile: Profile, libraryId: string): boolean =>
  profile.libraryAccess === 'all' || profile.libraryIds.includes(libraryId)

/**
 * "Profiles with access" (§14: "set by the admin from the library or from the profile"): the
 * same `library_access` / `profile_libraries` the profile page edits, seen from one library.
 * Admin only (`/admin/libraries/:id/profiles`).
 */
export const libraryAccessFactory = ({
  profileRepository,
  accountRepository,
  libraryRepository,
  profileChanged,
  logger,
}: Deps) => {
  const everyone = (): { profile: Profile; username: string }[] =>
    accountRepository
      .list()
      .flatMap((account) =>
        profileRepository
          .listByAccount(account.id)
          .map((profile) => ({ profile, username: account.username })),
      )

  const view = (libraryId: string): LibraryProfileAccess[] =>
    everyone().map(({ profile, username }) => ({
      profile,
      username,
      hasAccess: sees(profile, libraryId),
    }))

  const libraryNotFound = (libraryId: string) =>
    err(appError('library/not_found', 'library not found', { context: { id: libraryId } }))

  return {
    list: ({
      libraryId,
    }: {
      libraryId: string
    }): Result<LibraryProfileAccess[], LibraryAccessError> =>
      libraryRepository.findById(libraryId) === undefined
        ? libraryNotFound(libraryId)
        : ok(view(libraryId)),

    /**
     * Exactly `profileIds` see the library afterwards. A profile that saw everything and loses
     * this library keeps every other one (`selected` with all the others); one that gains it keeps
     * its own selection plus this library.
     */
    set: ({
      libraryId,
      profileIds,
    }: {
      libraryId: string
      profileIds: readonly string[]
    }): Result<LibraryProfileAccess[], LibraryAccessError> => {
      if (libraryRepository.findById(libraryId) === undefined) return libraryNotFound(libraryId)
      const all = everyone()
      const known = new Set(all.map(({ profile }) => profile.id))
      const unknown = profileIds.filter((id) => !known.has(id))
      if (unknown.length > 0) {
        return err(
          appError('profile/not_found', 'profile not found', { context: { profileIds: unknown } }),
        )
      }
      const wanted = new Set(profileIds)
      const libraryIds = libraryRepository.list().map((library) => library.id)
      const changes = all.flatMap(({ profile }): Profile[] => {
        const should = wanted.has(profile.id)
        if (should === sees(profile, libraryId)) return []
        return [
          should
            ? {
                ...profile,
                libraryAccess: 'selected',
                libraryIds: [...profile.libraryIds, libraryId],
              }
            : {
                ...profile,
                libraryAccess: 'selected',
                libraryIds: (profile.libraryAccess === 'all'
                  ? libraryIds
                  : profile.libraryIds
                ).filter((id) => id !== libraryId),
              },
        ]
      })
      // §14: an admin account keeps at least one unrestricted profile.
      const lockedOut = accountRepository.list().find((account) => {
        const before = profileRepository.listByAccount(account.id)
        const after = before.map((p) => changes.find((next) => next.id === p.id) ?? p)
        return removesLastUnrestricted({ role: account.role, before, after })
      })
      if (lockedOut !== undefined) {
        return err(
          appError(
            'profile/last_unrestricted',
            'an admin account keeps at least one unrestricted profile',
            { context: { accountId: lockedOut.id } },
          ),
        )
      }
      for (const next of changes) {
        profileRepository.update(next)
        profileChanged(next.id)
      }
      logger.info('library access updated', { libraryId, profiles: profileIds.length })
      return ok(view(libraryId))
    },
  }
}

export type LibraryAccess = ReturnType<typeof libraryAccessFactory>
