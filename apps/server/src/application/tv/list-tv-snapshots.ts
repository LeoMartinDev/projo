import { TV_SNAPSHOT_SHOWN_MS } from '@projo/shared/api/tv'

import type { Clock } from '../../core/clock.ts'
import type { TvSnapshotRepository } from '../../core/tv/snapshot.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'

/**
 * The snapshots a profile's TV page shows (§29.7): those of enabled, present channels taken in
 * the last hour; none without Live TV access (§29.6).
 */
export const listTvSnapshotsFactory =
  ({
    tvAccess,
    snapshots,
    clock,
  }: {
    tvAccess: TvProfileAccess
    snapshots: Pick<TvSnapshotRepository, 'freshSnapshots'>
    clock: Clock
  }) =>
  ({ profileId }: { profileId: string }): ReadonlyMap<string, Date> =>
    tvAccess.hasLiveTv(profileId)
      ? snapshots.freshSnapshots(new Date(clock.now().getTime() - TV_SNAPSHOT_SHOWN_MS))
      : new Map()

export type ListTvSnapshots = ReturnType<typeof listTvSnapshotsFactory>
