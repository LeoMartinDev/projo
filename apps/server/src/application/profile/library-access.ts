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
  profileChanged: (profileId: string) => void
  logger: Logger
}

export type LibraryProfileAccess = {
  profile: Profile
  username: string
  hasAccess: boolean
}

export type LibraryAccessError = AppError<
  'library/not_found' | 'profile/not_found' | 'profile/last_unrestricted'
>

const sees = (profile: Profile, libraryId: string): boolean =>
  profile.libraryAccess === 'all' || profile.libraryIds.includes(libraryId)

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
