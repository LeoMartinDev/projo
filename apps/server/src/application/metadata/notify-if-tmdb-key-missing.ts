import type { MetadataItemRepository, MetadataSettings } from '../../core/metadata/ports.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import { TMDB_NOTIFICATION_KEY } from './shared/tmdb-notification-key.ts'

type Deps = {
  settings: Pick<MetadataSettings, 'tmdbApiKey'>
  items: Pick<MetadataItemRepository, 'sourcesAwaitingMatch'>
  notifier: Pick<AdminNotifier, 'notify'>
}

export const notifyIfTmdbKeyMissingFactory =
  ({ settings, items, notifier }: Deps) =>
  (): void => {
    if (settings.tmdbApiKey() !== undefined) return
    if (items.sourcesAwaitingMatch({ reviewReasons: [] }).length === 0) return
    notifier.notify({
      kind: 'metadata/tmdb_key_missing',
      severity: 'warning',
      key: TMDB_NOTIFICATION_KEY,
      context: {},
    })
  }

export type NotifyIfTmdbKeyMissing = ReturnType<typeof notifyIfTmdbKeyMissingFactory>
