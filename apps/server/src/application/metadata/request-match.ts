import type { JobQueue } from '../../core/jobs/ports.ts'
import type { MatchRequester, MetadataSettings } from '../../core/metadata/ports.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import { TMDB_NOTIFICATION_KEY } from './match-source.ts'

type Deps = {
  settings: Pick<MetadataSettings, 'tmdbApiKey'>
  notifier: AdminNotifier
  jobQueue: JobQueue
}

/**
 * What the scanner calls once a source is ready (§7.2 "→ matching"): enqueues `match_source`
 * (§18, one per source). Without a TMDB key nothing is queued: the source stays `unmatched` with
 * its local items and one notification tells the admin (§9.1); setting the key relaunches them.
 */
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
