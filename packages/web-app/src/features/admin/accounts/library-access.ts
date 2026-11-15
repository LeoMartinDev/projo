import type { LibraryAccess } from '@projo/shared/api/profiles'

type Access = { libraryAccess: LibraryAccess; libraryIds: readonly string[] }

export const toggleLibrary = (
  access: Access,
  libraryIds: readonly string[],
  libraryId: string,
  checked: boolean,
): Access => {
  const current = access.libraryAccess === 'all' ? libraryIds : access.libraryIds
  const others = current.filter((id) => id !== libraryId)
  return { libraryAccess: 'selected', libraryIds: checked ? [...others, libraryId] : others }
}
