import type { JobQueue } from '../../core/jobs/ports.ts'
import type { MatchRequester, MetadataSettings } from '../../core/metadata/ports.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import { TMDB_NOTIFICATION_KEY } from './match-source.ts'

type Deps = {
  settings: Pick<MetadataSettings, 'tmdbApiKey'>
  notifier: AdminNotifier
  jobQueue: JobQueue
}

export const requestMatchFactory =
  ({ settings, notifier, jobQueue }: Deps): MatchRequester =>
  ({ sourceId }) => {
    if (settings.tmdbApiKey() === undefined) {
      notifier.notify({
        kind: 'metadata/tmdb_key_missing',
        severity: 'warning',
        key: TMDB_NOTIFICATION_KEY,
        context: {},
      })
      return
    }
    jobQueue.enqueue({
      type: 'match_source',
      payload: { sourceId },
      dedupeKey: `match:${sourceId}`,
    })
  }
