import type { AppError, Result } from '@projo/shared'

export type FsError = AppError<
  'fs/path_not_found' | 'fs/not_a_directory' | 'fs/permission_denied' | 'fs/io_error'
>

export type FileKind = 'file' | 'directory' | 'other'

export type FileStat = {
  kind: FileKind
  sizeBytes: number
  mtimeMs: number
  inode: string
}

export type DirectoryEntry = {
  name: string
  kind: FileKind | 'symlink'
}

export type FileSystem = {
  stat: (path: string) => Promise<Result<FileStat, FsError>>
  readDirectory: (path: string) => Promise<Result<DirectoryEntry[], FsError>>
  realPath: (path: string) => Promise<Result<string, FsError>>
}

export type WatchMode = 'recursive' | 'per_directory'

export type WatchHandle = {
  mode: WatchMode
  close: () => void
}

export type WatchInput = {
  path: string
  fallbackDirectories: readonly string[]
  onChange: (relativePath: string | undefined) => void
  onError: (error: FsError) => void
}

export type DirectoryWatcher = {
  watch: (input: WatchInput) => Result<WatchHandle, FsError>
}
