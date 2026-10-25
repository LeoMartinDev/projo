import type { RootErrorReason } from '@projo/shared/api/libraries'

import type { FileStat, FsError } from '../fs/file-system.ts'

/** `reason` is stored on the root (`last_error`); `message`, in English, goes to the logs. */
export type RootAssessment =
  { kind: 'ok' } | { kind: 'unreachable'; reason: RootErrorReason; message: string }

const unreachable = (reason: RootErrorReason, message: string): RootAssessment => ({
  kind: 'unreachable',
  reason,
  message,
})

/**
 * §7.5 guard, before the root's directory listing is trusted: a missing path, an I/O error or
 * something that is not a directory means the disk is not there, never that the files are gone.
 */
export const assessRootStat = (
  stat: { ok: true; value: FileStat } | { ok: false; error: FsError },
) => {
  if (!stat.ok) {
    return stat.error.code === 'fs/path_not_found'
      ? unreachable('not_found', 'root directory does not exist')
      : unreachable('io_error', `root directory cannot be read: ${stat.error.message}`)
  }
  return stat.value.kind === 'directory'
    ? ({ kind: 'ok' } as RootAssessment)
    : unreachable('not_directory', 'root path is not a directory')
}

/**
 * §7.5 guard, after the walk: a root that used to hold videos and is now empty (unmounted mount
 * point) or holds no video at all is treated as unreachable, so nothing is marked missing. When
 * every file really was deleted, the sources stay until the admin removes the root or the library.
 */
export const assessRootContent = ({
  entryCount,
  videoCount,
  lastFileCount,
}: {
  entryCount: number
  videoCount: number
  lastFileCount: number
}): RootAssessment => {
  if (lastFileCount === 0) return { kind: 'ok' }
  if (entryCount === 0) return unreachable('empty', 'root directory is empty')
  if (videoCount === 0) return unreachable('no_media', 'root directory holds no video anymore')
  return { kind: 'ok' }
}
