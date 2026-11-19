import type { NotificationDto, NotificationKind } from '@projo/shared/api/notifications'
import type { AdminSettingsDto } from '@projo/shared/api/settings'
import type { AdminStatsDto } from '@projo/shared/api/system'

/** One subject of the overview's "To do" (§15): what needs the admin, with one way to act. */
export type TodoItem =
  | { kind: 'tmdb'; state: 'missing' | 'rejected' }
  | { kind: 'review'; count: number }
  | { kind: 'missing'; count: number }
  | { kind: 'failedJobs'; count: number }
  | { kind: 'update'; version: string; runtimeCompatible: boolean }
  | {
      kind: 'notifications'
      notificationKind: NotificationKind
      count: number
      latest: NotificationDto
    }

type TodoInput = {
  tmdbKey: AdminSettingsDto['metadata']['tmdbApiKey']['state'] | undefined
  stats: Pick<AdminStatsDto, 'counts' | 'failedJobs' | 'updateAvailable'> | undefined
  /** Unread notifications, newest first. */
  unread: readonly NotificationDto[]
}

/** The notification kinds a live subject already says, so they are not repeated under it. */
const coveredKinds = (item: TodoItem): readonly NotificationKind[] => {
  switch (item.kind) {
    case 'tmdb':
      return ['metadata/tmdb_key_missing', 'tmdb/unauthorized']
    case 'review':
      return ['scan/needs_review_count']
    case 'missing':
      return ['scan/many_missing']
    case 'failedJobs':
      return ['job/failed']
    case 'update':
      return item.runtimeCompatible
        ? ['update/available']
        : ['update/available', 'update/runtime_too_old']
    case 'notifications':
      return []
  }
}

/**
 * The "To do" of the overview: live subjects first (TMDB key, files to review, missing files, jobs
 * failed in the last 24 h, an update), then the unread notifications one row per kind (the newest
 * first), except the kinds a live subject above already says.
 */
export const todoItems = ({ tmdbKey, stats, unread }: TodoInput): TodoItem[] => {
  const live: TodoItem[] = [
    ...(tmdbKey === 'missing' || tmdbKey === 'rejected'
      ? [{ kind: 'tmdb' as const, state: tmdbKey }]
      : []),
    ...(stats !== undefined && stats.counts.needsReview > 0
      ? [{ kind: 'review' as const, count: stats.counts.needsReview }]
      : []),
    ...(stats !== undefined && stats.counts.missingSources > 0
      ? [{ kind: 'missing' as const, count: stats.counts.missingSources }]
      : []),
    ...(stats !== undefined && stats.failedJobs > 0
      ? [{ kind: 'failedJobs' as const, count: stats.failedJobs }]
      : []),
    ...(stats?.updateAvailable === undefined
      ? []
      : [
          {
            kind: 'update' as const,
            version: stats.updateAvailable.version,
            runtimeCompatible: stats.updateAvailable.runtimeCompatible,
          },
        ]),
  ]
  const covered = new Set(live.flatMap(coveredKinds))
  const groups = new Map<NotificationKind, { latest: NotificationDto; count: number }>()
  for (const notification of unread) {
    if (covered.has(notification.kind)) continue
    const group = groups.get(notification.kind)
    if (group === undefined) groups.set(notification.kind, { latest: notification, count: 1 })
    else group.count += 1
  }
  const notifications = [...groups.entries()].map(
    ([notificationKind, { latest, count }]): TodoItem => ({
      kind: 'notifications',
      notificationKind,
      count,
      latest,
    }),
  )
  return [...live, ...notifications]
}
