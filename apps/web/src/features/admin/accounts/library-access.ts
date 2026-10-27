import type { LibraryAccess } from '@projo/shared/api/profiles'

type Access = { libraryAccess: LibraryAccess; libraryIds: readonly string[] }

/**
 * Ticks or unticks one library of a profile. Never promotes to `all`, even when every current
 * library is ticked: `all` also covers future libraries, so only "All libraries" sets it.
 */
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
