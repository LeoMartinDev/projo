import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  MatchRequester,
  MetadataItemRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import type { TmdbApi } from '../../core/metadata/tmdb.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import type { QueueStaleLanguageRefresh } from './queue-stale-language-refresh.ts'
import {
  type MetadataSettingsView,
  metadataSettingsViewOf,
} from './shared/metadata-settings-view.ts'
import { tmdbReviewReasons } from './shared/resolve-match.ts'
import { TMDB_NOTIFICATION_KEY } from './shared/tmdb-notification-key.ts'

type Deps = {
  settings: MetadataSettings
  tmdb: Pick<TmdbApi, 'validateKey'>
  items: Pick<MetadataItemRepository, 'sourcesAwaitingMatch'>
  requestMatch: MatchRequester
  queueStaleLanguageRefresh: QueueStaleLanguageRefresh
  notifier: AdminNotifier
  clock: Clock
  logger: Logger
}

export type UpdateMetadataSettingsError = AppError<
  'metadata/tmdb_key_invalid' | 'metadata/tmdb_unavailable' | 'metadata/tmdb_invalid_response'
>

export const updateMetadataSettingsFactory = ({
  settings,
  tmdb,
  items,
  requestMatch,
  queueStaleLanguageRefresh,
  notifier,
  clock,
  logger,
}: Deps) => {
  const relaunchMatching = (libraryId?: string): number => {
    const sourceIds = items.sourcesAwaitingMatch({
      ...(libraryId === undefined ? {} : { libraryId }),
      reviewReasons: tmdbReviewReasons,
    })
    for (const sourceId of sourceIds) requestMatch({ sourceId })
    return sourceIds.length
  }

  return async (input: {
    language?: string
    tmdbApiKey?: string
  }): Promise<Result<MetadataSettingsView, UpdateMetadataSettingsError>> => {
    const now = clock.now()
    if (input.tmdbApiKey !== undefined && input.tmdbApiKey !== '') {
      const checked = await tmdb.validateKey(input.tmdbApiKey)
      if (!checked.ok) {
        const { error } = checked
        if (
          error.code === 'metadata/tmdb_unavailable' ||
          error.code === 'metadata/tmdb_invalid_response'
        ) {
          return err({ ...error, code: error.code })
        }
        return err(appError('metadata/tmdb_key_invalid', 'TMDB refused this API key'))
      }
    }
    if (input.language !== undefined) {
      const previous = settings.language()
      settings.setLanguage({ language: input.language, at: now })
      if (input.language !== previous) queueStaleLanguageRefresh()
    }
    if (input.tmdbApiKey !== undefined) {
      const key = input.tmdbApiKey === '' ? undefined : input.tmdbApiKey
      const previous = settings.tmdbApiKey()
      settings.setTmdbApiKey({ key, at: now })
      if (key !== undefined) {
        notifier.resolve({ kind: 'metadata/tmdb_key_missing', key: TMDB_NOTIFICATION_KEY })
        notifier.resolve({ kind: 'tmdb/unauthorized', key: TMDB_NOTIFICATION_KEY })
        if (key !== previous) {
          const relaunched = relaunchMatching()
          logger.info('TMDB key set, matching relaunched', { sources: relaunched })
        }
      } else {
        logger.info('TMDB key removed')
      }
    }
    return ok(metadataSettingsViewOf(settings))
  }
}

export type UpdateMetadataSettings = ReturnType<typeof updateMetadataSettingsFactory>
