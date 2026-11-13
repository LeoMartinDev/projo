import { appError, err, ok, type Result } from '@projo/shared'

import { removesLastUnrestricted } from '../../core/account/last-admin.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'
import {
  everyProfile,
  type LibraryAccessError,
  libraryNotFound,
  type LibraryProfileAccess,
  libraryProfileAccess,
  type LibraryProfileAccessDeps,
  sees,
} from './shared/library-profile-access.ts'

type Deps = Omit<LibraryProfileAccessDeps, 'profileRepository'> & {
  profileRepository: Pick<ProfileRepository, 'listByAccount' | 'update'>
  libraryRepository: Pick<LibraryRepository, 'list' | 'findById'>
  profileChanged: (profileId: string) => void
  logger: Logger
}

export const setLibraryAccessFactory =
  (deps: Deps) =>
  ({
    libraryId,
    profileIds,
  }: {
    libraryId: string
    profileIds: readonly string[]
  }): Result<LibraryProfileAccess[], LibraryAccessError> => {
    const { profileRepository, accountRepository, libraryRepository, profileChanged, logger } = deps
    if (libraryRepository.findById(libraryId) === undefined) return libraryNotFound(libraryId)
    const all = everyProfile(deps)
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
    return ok(libraryProfileAccess(deps, libraryId))
  }

export type SetLibraryAccess = ReturnType<typeof setLibraryAccessFactory>
