import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { LibraryRepository } from '../../core/library/library.ts'
import {
  type LibraryView,
  libraryViewFactory,
  type LibraryViewDeps,
} from './shared/library-view.ts'

type Deps = LibraryViewDeps & { libraryRepository: Pick<LibraryRepository, 'findById'> }

export type GetLibraryError = AppError<'library/not_found'>

export const getLibraryFactory = ({ libraryRepository, ...viewDeps }: Deps) => {
  const view = libraryViewFactory(viewDeps)
  return ({ id }: { id: string }): Result<LibraryView, GetLibraryError> => {
    const library = libraryRepository.findById(id)
    return library === undefined
      ? err(appError('library/not_found', 'library not found', { context: { id } }))
      : ok(view(library))
  }
}

export type GetLibrary = ReturnType<typeof getLibraryFactory>
