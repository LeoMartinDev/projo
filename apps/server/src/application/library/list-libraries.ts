import type { LibraryRepository } from '../../core/library/library.ts'
import {
  type LibraryView,
  libraryViewFactory,
  type LibraryViewDeps,
} from './shared/library-view.ts'

type Deps = LibraryViewDeps & { libraryRepository: Pick<LibraryRepository, 'list'> }

export const listLibrariesFactory = ({ libraryRepository, ...viewDeps }: Deps) => {
  const view = libraryViewFactory(viewDeps)
  return (): LibraryView[] => libraryRepository.list().map(view)
}

export type ListLibraries = ReturnType<typeof listLibrariesFactory>
