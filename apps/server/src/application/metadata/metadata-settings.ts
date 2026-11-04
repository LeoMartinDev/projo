import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  MatchRequester,
  MetadataItemRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import type { TmdbApi } from '../../core/metadata/tmdb.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import { TMDB_NOTIFICATION_KEY } from './match-source.ts'
import type { RefreshMetadata } from './refresh-metadata.ts'
import { tmdbReviewReasons } from './resolve-match.ts'

type Deps = {
  settings: MetadataSettings
  tmdb: Pick<TmdbApi, 'validateKey'>
  items: Pick<MetadataItemRepository, 'sourcesAwaitingMatch'>
  requestMatch: MatchRequester
  refresh: Pick<RefreshMetadata, 'queueStaleLanguage'>
  notifier: AdminNotifier
  clock: Clock
  logger: Logger
}

export type TmdbKeyState = 'missing' | 'valid' | 'rejected'

export type MetadataSettingsView = {
  language: string
  tmdbApiKey: { configured: boolean; state: TmdbKeyState; last4?: string }
}

export type UpdateMetadataSettingsError = AppError<
  'metadata/tmdb_key_invalid' | 'metadata/tmdb_unavailable' | 'metadata/tmdb_invalid_response'
>

export const metadataSettingsFactory = ({
  settings,
  tmdb,
  items,
  requestMatch,
  refresh,
  notifier,
  clock,
  logger,
}: Deps) => {
  const view = (): MetadataSettingsView => {
    const key = settings.tmdbApiKey()
    return {
      language: settings.language(),
      tmdbApiKey:
        key === undefined
          ? { configured: false, state: 'missing' }
          : {
              configured: true,
              state: settings.tmdbApiKeyRejectedAt() === undefined ? 'valid' : 'rejected',
              last4: key.slice(-4),
            },
    }
  }

  const relaunchMatching = (libraryId?: string): number => {
    const sourceIds = items.sourcesAwaitingMatch({
      ...(libraryId === undefined ? {} : { libraryId }),
      reviewReasons: tmdbReviewReasons,
    })
    for (const sourceId of sourceIds) requestMatch({ sourceId })
    return sourceIds.length
  }

  return {
    get: view,
    relaunchMatching,
    notifyIfKeyMissing: (): void => {
      if (settings.tmdbApiKey() !== undefined) return
      if (items.sourcesAwaitingMatch({ reviewReasons: [] }).length === 0) return
      notifier.notify({
        kind: 'metadata/tmdb_key_missing',
        severity: 'warning',
        key: TMDB_NOTIFICATION_KEY,
        context: {},
      })
    },
    update: async (input: {
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
        if (input.language !== previous) refresh.queueStaleLanguage()
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
      return ok(view())
    },
  }
}

export type MetadataSettingsAdmin = ReturnType<typeof metadataSettingsFactory>
