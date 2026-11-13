import { ok, type Result } from '@projo/shared'

import type { VisibleItems } from '../../core/catalog/catalog.ts'
import type { TrackPreferenceRepository } from '../../core/playback/track-preferences.ts'
import { memoryTargetOf } from './shared/memory-target.ts'
import {
  playableItem,
  type TrackPreferencesError,
  type TrackPreferenceTarget,
} from './shared/track-preference-target.ts'

export const clearTrackPreferencesFactory =
  ({
    visibleItems,
    trackPreferenceRepository,
  }: {
    visibleItems: Pick<VisibleItems, 'findVisible'>
    trackPreferenceRepository: TrackPreferenceRepository
  }) =>
  async (target: TrackPreferenceTarget): Promise<Result<void, TrackPreferencesError>> => {
    const item = playableItem(visibleItems, target)
    if (!item.ok) return item
    const { ownerId } = memoryTargetOf(visibleItems, item.value, target.scope)
    trackPreferenceRepository.delete({ profileId: target.profileId, itemId: ownerId })
    return ok()
  }

export type ClearTrackPreferences = ReturnType<typeof clearTrackPreferencesFactory>
