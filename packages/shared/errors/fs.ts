export const fsErrorCodes = [
  'fs/invalid_path',
  'fs/path_not_found',
  'fs/not_a_directory',
  'fs/permission_denied',
  'fs/io_error',
] as const

export type FsErrorCode = (typeof fsErrorCodes)[number]
