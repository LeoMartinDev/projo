import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'

import {
  type CatalogItem,
  type CatalogRepository,
  isPlayableKind,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { normalizeLanguage } from '../../core/naming/index.ts'
import type {
  TrackPreferenceRepository,
  TrackPreferences,
} from '../../core/playback/track-preferences.ts'

/**
 * Where the §11.3 memory of a movie or an episode lives, and what the §11.1 anime rule needs of
 * the work (original language, genres).
 */
export type MemoryTarget = {
  /** The movie itself, or the series of the episode (the episode when it has none). */
  ownerId: string
  /** TMDB `original_language` of the movie, or of the episode (else its series). */
  originalLanguage?: string
  /** Genres of the movie, or of the episode's series (the episode's own when it has none). */
  genres: readonly GenreId[]
}

/** Up from an episode (season, then series) through visible items only. */
export const memoryTargetOf = (
  catalogRepository: CatalogRepository,
  item: CatalogItem,
  scope: VisibilityScope,
): MemoryTarget => {
  let series: CatalogItem | undefined
  let current: CatalogItem | undefined = item
  for (let depth = 0; depth < 2 && current?.parentId !== undefined; depth += 1) {
    current = catalogRepository.findVisible({ id: current.parentId, scope })
    if (current?.kind === 'series') series = current
  }
  const owner = item.kind === 'episode' ? (series ?? item) : item
  const originalLanguage = item.originalLanguage ?? series?.originalLanguage
  return {
    ownerId: owner.id,
    ...(originalLanguage === undefined ? {} : { originalLanguage }),
    genres: owner.genres,
  }
}

export type TrackPreferencesError = AppError<'item/not_found' | 'item/invalid_kind'>

type Target = { profileId: string; itemId: string; scope: VisibilityScope }

const playableItem = (
  catalogRepository: CatalogRepository,
  { itemId, scope }: Target,
): Result<CatalogItem, TrackPreferencesError> => {
  const item = catalogRepository.findVisible({ id: itemId, scope })
  if (item === undefined) {
    return err(appError('item/not_found', 'item not found', { context: { itemId } }))
  }
  if (!isPlayableKind(item.kind)) {
    return err(
      appError('item/invalid_kind', 'track preferences are set from a movie or an episode', {
        context: { itemId, kind: item.kind },
      }),
    )
  }
  return ok(item)
}

const normalized = (language: string | undefined): string | undefined =>
  language === undefined ? undefined : (normalizeLanguage(language) ?? language.toLowerCase())

type Deps = {
  catalogRepository: CatalogRepository
  trackPreferenceRepository: TrackPreferenceRepository
  clock: Clock
  logger: Logger
}

/**
 * `PUT /items/:id/track-preferences` (§11.3): `:id` is the movie or episode played, the memory
 * is stored on the movie or on the episode's series. Only items the profile sees (§14).
 */
export const setTrackPreferencesFactory =
  ({ catalogRepository, trackPreferenceRepository, clock, logger }: Deps) =>
  async (
    target: Target & {
      audioLanguage?: string
      subtitleLanguage?: string
      subtitlesEnabled: boolean
    },
  ): Promise<Result<TrackPreferences, TrackPreferencesError>> => {
    const item = playableItem(catalogRepository, target)
    if (!item.ok) return item
    const { ownerId } = memoryTargetOf(catalogRepository, item.value, target.scope)
    const audioLanguage = normalized(target.audioLanguage)
    const subtitleLanguage = normalized(target.subtitleLanguage)
    const preferences: TrackPreferences = {
      profileId: target.profileId,
      itemId: ownerId,
      ...(audioLanguage === undefined ? {} : { audioLanguage }),
      ...(subtitleLanguage === undefined ? {} : { subtitleLanguage }),
      subtitlesEnabled: target.subtitlesEnabled,
      updatedAt: clock.now(),
    }
    trackPreferenceRepository.save(preferences)
    logger.debug('track preferences saved', { profileId: target.profileId, itemId: ownerId })
    return ok(preferences)
  }

/** `DELETE /items/:id/track-preferences`: forgets the memory ("Undo"); idempotent. */
export const clearTrackPreferencesFactory =
  ({ catalogRepository, trackPreferenceRepository }: Omit<Deps, 'clock' | 'logger'>) =>
  async (target: Target): Promise<Result<void, TrackPreferencesError>> => {
    const item = playableItem(catalogRepository, target)
    if (!item.ok) return item
    const { ownerId } = memoryTargetOf(catalogRepository, item.value, target.scope)
    trackPreferenceRepository.delete({ profileId: target.profileId, itemId: ownerId })
    return ok()
  }

export type SetTrackPreferences = ReturnType<typeof setTrackPreferencesFactory>
export type ClearTrackPreferences = ReturnType<typeof clearTrackPreferencesFactory>
