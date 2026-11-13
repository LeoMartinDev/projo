import { ok, type Result } from '@projo/shared'

import type { VisibleItems } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { normalizeLanguage } from '../../core/naming/index.ts'
import type {
  TrackPreferenceRepository,
  TrackPreferences,
} from '../../core/playback/track-preferences.ts'
import { memoryTargetOf } from './shared/memory-target.ts'
import {
  playableItem,
  type TrackPreferencesError,
  type TrackPreferenceTarget,
} from './shared/track-preference-target.ts'

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
    target: TrackPreferenceTarget & {
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

export type SetTrackPreferences = ReturnType<typeof setTrackPreferencesFactory>
