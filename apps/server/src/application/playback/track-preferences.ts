import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'

import {
  type CatalogItem,
  isPlayableKind,
  type VisibilityScope,
  type VisibleItems,
} from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { normalizeLanguage } from '../../core/naming/index.ts'
import type {
  TrackPreferenceRepository,
  TrackPreferences,
} from '../../core/playback/track-preferences.ts'

export type MemoryTarget = {
  ownerId: string
  originalLanguage?: string
  genres: readonly GenreId[]
}

export const memoryTargetOf = (
  visibleItems: Pick<VisibleItems, 'findVisible'>,
  item: CatalogItem,
  scope: VisibilityScope,
): MemoryTarget => {
  let series: CatalogItem | undefined
  let current: CatalogItem | undefined = item
  for (let depth = 0; depth < 2 && current?.parentId !== undefined; depth += 1) {
    current = visibleItems.findVisible({ id: current.parentId, scope })
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
  visibleItems: Pick<VisibleItems, 'findVisible'>,
  { itemId, scope }: Target,
): Result<CatalogItem, TrackPreferencesError> => {
  const item = visibleItems.findVisible({ id: itemId, scope })
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
  visibleItems: Pick<VisibleItems, 'findVisible'>
  trackPreferenceRepository: TrackPreferenceRepository
  clock: Clock
  logger: Logger
}

export const setTrackPreferencesFactory =
  ({ visibleItems, trackPreferenceRepository, clock, logger }: Deps) =>
  async (
    target: Target & {
      audioLanguage?: string
      subtitleLanguage?: string
      subtitlesEnabled: boolean
    },
  ): Promise<Result<TrackPreferences, TrackPreferencesError>> => {
    const item = playableItem(visibleItems, target)
    if (!item.ok) return item
    const { ownerId } = memoryTargetOf(visibleItems, item.value, target.scope)
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

export const clearTrackPreferencesFactory =
  ({ visibleItems, trackPreferenceRepository }: Omit<Deps, 'clock' | 'logger'>) =>
  async (target: Target): Promise<Result<void, TrackPreferencesError>> => {
    const item = playableItem(visibleItems, target)
    if (!item.ok) return item
    const { ownerId } = memoryTargetOf(visibleItems, item.value, target.scope)
    trackPreferenceRepository.delete({ profileId: target.profileId, itemId: ownerId })
    return ok()
  }

export type SetTrackPreferences = ReturnType<typeof setTrackPreferencesFactory>
export type ClearTrackPreferences = ReturnType<typeof clearTrackPreferencesFactory>
