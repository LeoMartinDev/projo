import type { AppError, Result } from '@projo/shared'

export type FsError = AppError<
  'fs/path_not_found' | 'fs/not_a_directory' | 'fs/permission_denied' | 'fs/io_error'
>

export type FileKind = 'file' | 'directory' | 'other'

export type FileStat = {
  kind: FileKind
  sizeBytes: number
  /** `fs.Stats#mtimeMs`, fractional milliseconds, compared strictly. */
  mtimeMs: number
  /** `<dev>:<ino>`: identifies a file across renames on the same device (§7.6). */
  inode: string
}

export type DirectoryEntry = {
  name: string
  kind: FileKind | 'symlink'
}

/** Read-only file system access (absolute paths). Symbolic links are followed by `stat`, not by `readDirectory`. */
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
  /** Absolute directory to watch. */
  path: string
  /**
   * Directories (relative to `path`) to watch one by one when recursive watching is unavailable
   * on the platform. Recomputed by the caller at each sync.
   */
  fallbackDirectories: readonly string[]
  /** A path under `path` changed (relative, `/`-separated), or `undefined` when unknown. */
  onChange: (relativePath: string | undefined) => void
  /** The watch broke (root unmounted, inotify limit…): the handle is closed. */
  onError: (error: FsError) => void
}

/** `fs.watch` port (§7.4). Notifications are hints: the scan is the only source of truth. */
export type DirectoryWatcher = {
  watch: (input: WatchInput) => Result<WatchHandle, FsError>
}
