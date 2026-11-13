import type { LibraryRepository } from '../../core/library/library.ts'

export type LibraryNames = Pick<LibraryRepository, 'list'>

export const libraryNamesOf = (libraries: LibraryNames): Map<string, string> =>
  new Map(libraries.list().map((library) => [library.id, library.name]))

export type NamedSource<S> = { source: S; library: string | undefined }

export const nameSources = <S extends { libraryId: string }>(
  libraries: LibraryNames,
  sources: readonly S[],
): NamedSource<S>[] => {
  const names = libraryNamesOf(libraries)
  return sources.map((source) => ({ source, library: names.get(source.libraryId) }))
}
