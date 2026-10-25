export const libraryErrorCodes = [
  'library/not_found',
  'library/name_taken',
  'library/root_not_found',
  'library/root_not_directory',
  'library/root_unreadable',
  'library/root_duplicate',
  'library/root_overlaps',
  'library/root_unreachable',
  'library/scan_already_running',
  'library/invalid_settings',
] as const

export type LibraryErrorCode = (typeof libraryErrorCodes)[number]
