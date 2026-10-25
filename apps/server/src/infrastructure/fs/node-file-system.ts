import { readdir, realpath, stat } from 'node:fs/promises'

import { appError, err, ok, type Result } from '@projo/shared'

import type { DirectoryEntry, FileStat, FileSystem, FsError } from '../../core/fs/file-system.ts'
import { type HostPaths, hostPaths, type VirtualDirectory } from './host-paths.ts'

const errnoOf = (cause: unknown): string | undefined => {
  if (!(cause instanceof Error)) return undefined
  const code: unknown = (cause as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Node errno → `fs/*` error. */
export const toFsError = (path: string, cause: unknown): FsError => {
  const errno = errnoOf(cause)
  const context = { path, errno }
  switch (errno) {
    case 'ENOENT':
      return appError('fs/path_not_found', 'path does not exist', { context, cause })
    case 'ENOTDIR':
      return appError('fs/not_a_directory', 'path is not a directory', { context, cause })
    case 'EACCES':
    case 'EPERM':
      return appError('fs/permission_denied', 'permission denied', { context, cause })
    default:
      return appError('fs/io_error', 'file system error', { context, cause })
  }
}

const attempt = async <T>(path: string, run: () => Promise<T>): Promise<Result<T, FsError>> => {
  try {
    return ok(await run())
  } catch (cause) {
    return err(toFsError(path, cause))
  }
}

const DRIVE_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

const asDirectories = (names: string[]) =>
  names.map((name): DirectoryEntry => ({ name, kind: 'directory' }))

/** The drives that answer (mapped network drives included): the folders of the virtual `/`. */
const listDrives = async (): Promise<DirectoryEntry[]> => {
  const found = await Promise.all(
    DRIVE_LETTERS.map((letter) =>
      stat(`${letter}:\\`).then(
        (stats) => (stats.isDirectory() ? letter : undefined),
        () => undefined,
      ),
    ),
  )
  return asDirectories(found.filter((letter) => letter !== undefined))
}

/** UNC servers and shares are not discovered: the path to a share is typed (`/UNC/nas/media`). */
const listVirtual = async (directory: VirtualDirectory): Promise<DirectoryEntry[]> =>
  directory.kind === 'drives' ? listDrives() : []

/**
 * `FileSystem` port over `node:fs/promises`. Read only. Takes and returns domain paths, translated
 * by `paths` (Windows drives and UNC shares, `host-paths.ts`).
 */
export const createNodeFileSystem = ({
  paths = hostPaths,
}: { paths?: HostPaths } = {}): FileSystem => {
  const onHost = async <T>(
    path: string,
    run: (hostPath: string) => Promise<T>,
  ): Promise<Result<T, FsError>> => {
    const hostPath = paths.toHost(path)
    if (hostPath === undefined) {
      return err(appError('fs/path_not_found', 'path does not exist', { context: { path } }))
    }
    return attempt(path, () => run(hostPath))
  }

  return {
    stat: async (path) =>
      paths.virtualDirectory(path) !== undefined
        ? ok({ kind: 'directory', sizeBytes: 0, mtimeMs: 0, inode: `virtual:${path}` })
        : onHost(path, async (hostPath): Promise<FileStat> => {
            const stats = await stat(hostPath)
            return {
              kind: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
              sizeBytes: stats.size,
              mtimeMs: stats.mtimeMs,
              inode: `${stats.dev}:${stats.ino}`,
            }
          }),
    readDirectory: async (path) => {
      const virtual = paths.virtualDirectory(path)
      if (virtual !== undefined) return attempt(path, () => listVirtual(virtual))
      return onHost(path, async (hostPath): Promise<DirectoryEntry[]> => {
        const entries = await readdir(hostPath, { withFileTypes: true })
        return entries.map((entry) => ({
          name: entry.name,
          kind: entry.isSymbolicLink()
            ? 'symlink'
            : entry.isDirectory()
              ? 'directory'
              : entry.isFile()
                ? 'file'
                : 'other',
        }))
      })
    },
    realPath: async (path) => {
      const virtual = paths.virtualDirectory(path)
      if (virtual !== undefined) return ok(virtual.path)
      return onHost(path, async (hostPath) => paths.fromHost(await realpath(hostPath)))
    },
  }
}
