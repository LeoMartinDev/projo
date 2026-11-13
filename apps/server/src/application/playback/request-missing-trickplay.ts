import type { JobQueue } from '../../core/jobs/ports.ts'
import type { MediaAssetCatalog, TrickplayStore } from '../../core/playback/media-assets.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'
import {
  isCurrentTrickplay,
  requestTrickplay,
  trickplayInProgressPriority,
} from './shared/trickplay-requests.ts'

export const requestMissingTrickplayFactory =
  ({
    mediaCatalog,
    playbackSettings,
    trickplayStore,
    jobQueue,
  }: {
    mediaCatalog: MediaAssetCatalog
    playbackSettings: PlaybackSettingsReader
    trickplayStore: TrickplayStore
    jobQueue: JobQueue
  }) =>
  (): number => {
    if (!playbackSettings.read().trickplayEnabled) return 0
    let queued = 0
    for (const candidate of mediaCatalog.listTrickplayCandidates()) {
      if (isCurrentTrickplay(trickplayStore.read(candidate.id), candidate.fingerprint)) continue
      requestTrickplay(
        jobQueue,
        candidate.id,
        candidate.inProgress ? { priority: trickplayInProgressPriority } : {},
      )
      queued += 1
    }
    return queued
  }

export type RequestMissingTrickplay = ReturnType<typeof requestMissingTrickplayFactory>
