import { ok, type Result } from '@projo/shared'

import type { PlayableSources } from '../../core/catalog/catalog.ts'
import type { Logger } from '../../core/logger.ts'
import type { MediaError } from '../../core/media/probe.ts'
import {
  type MediaAssetCatalog,
  trickplayHeight,
  type TrickplayStore,
} from '../../core/playback/media-assets.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'
import { sourceFingerprint } from './shared/source-fingerprint.ts'
import { isCurrentTrickplay } from './shared/trickplay-requests.ts'

export const generateTrickplayFactory =
  ({
    playableSources,
    mediaCatalog,
    playbackSettings,
    trickplayStore,
    logger,
  }: {
    playableSources: Pick<PlayableSources, 'findSource'>
    mediaCatalog: MediaAssetCatalog
    playbackSettings: PlaybackSettingsReader
    trickplayStore: TrickplayStore
    logger: Logger
  }) =>
  async ({
    sourceId,
    signal,
  }: {
    sourceId: string
    signal?: AbortSignal
  }): Promise<Result<'generated' | 'skipped', MediaError>> => {
    if (!playbackSettings.read().trickplayEnabled) return ok('skipped')
    if (mediaCatalog.libraryFlags(sourceId)?.trickplayEnabled !== true) return ok('skipped')
    const source = playableSources.findSource(sourceId)
    if (source === undefined || source.state !== 'ready' || !source.rootReachable) {
      return ok('skipped')
    }
    if (isCurrentTrickplay(trickplayStore.read(source.id), sourceFingerprint(source))) {
      return ok('skipped')
    }
    const video = source.media?.video[0]
    const durationMs = source.media?.durationMs ?? 0
    if (video === undefined || !(durationMs > 0)) return ok('skipped')
    const generated = await trickplayStore.generate({
      sourceId,
      path: source.path,
      videoStreamIndex: video.index,
      height: trickplayHeight(video),
      durationMs,
      fingerprint: sourceFingerprint(source),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!generated.ok) return generated
    logger.info('trickplay generated', { sourceId, sheets: generated.value.sheets.length })
    return ok('generated')
  }

export type GenerateTrickplay = ReturnType<typeof generateTrickplayFactory>
