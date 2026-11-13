import { ok, type Result } from '@projo/shared'

import type { LibraryRepository } from '../../core/library/library.ts'
import {
  type LibraryAccessError,
  libraryNotFound,
  type LibraryProfileAccess,
  libraryProfileAccess,
  type LibraryProfileAccessDeps,
} from './shared/library-profile-access.ts'

type Deps = LibraryProfileAccessDeps & {
  libraryRepository: Pick<LibraryRepository, 'findById'>
}

export const listLibraryAccessFactory =
  (deps: Deps) =>
  ({ libraryId }: { libraryId: string }): Result<LibraryProfileAccess[], LibraryAccessError> =>
    deps.libraryRepository.findById(libraryId) === undefined
      ? libraryNotFound(libraryId)
      : ok(libraryProfileAccess(deps, libraryId))

export type ListLibraryAccess = ReturnType<typeof listLibraryAccessFactory>
