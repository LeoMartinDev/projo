import type { Logger } from '../../../core/logger.ts'
import type { TvLogoFiles } from '../../../core/tv/logo.ts'
import { type TvSnapshotRepository, tvSnapshotPathOf } from '../../../core/tv/snapshot.ts'

/**
 * Stores a channel's new snapshot (§29.4): the file (written to a temporary one, then renamed
 * over the previous), then its time on the channel. A channel gone meanwhile loses the file.
 * `false` when nothing was stored.
 */
export const storeSnapshot = async ({
  files,
  snapshots,
  logger,
  channelId,
  bytes,
  at,
  grabbed,
}: {
  files: Pick<TvLogoFiles, 'write' | 'remove'>
  snapshots: Pick<TvSnapshotRepository, 'recordSnapshot'>
  logger: Logger
  channelId: string
  bytes: Uint8Array
  at: Date
  grabbed: boolean
}): Promise<boolean> => {
  const path = tvSnapshotPathOf(channelId)
  const written = await files.write({ path, bytes })
  if (!written.ok) {
    logger.warn('tv snapshot not written', { channelId, code: written.error.code })
    return false
  }
  if (snapshots.recordSnapshot({ id: channelId, at, grabbed })) return true
  await files.remove(path)
  return false
}
