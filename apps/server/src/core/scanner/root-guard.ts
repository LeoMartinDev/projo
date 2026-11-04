import type { RootErrorReason } from '@projo/shared/api/libraries'

import type { FileStat, FsError } from '../fs/file-system.ts'

export type RootAssessment =
  { kind: 'ok' } | { kind: 'unreachable'; reason: RootErrorReason; message: string }

const unreachable = (reason: RootErrorReason, message: string): RootAssessment => ({
  kind: 'unreachable',
  reason,
  message,
})

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
