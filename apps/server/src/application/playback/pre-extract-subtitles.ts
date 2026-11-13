import { ok, type Result } from '@projo/shared'

import type { PlayableSources } from '../../core/catalog/catalog.ts'
import type { Logger } from '../../core/logger.ts'
import {
  isTextSubtitle,
  type MediaAssetCatalog,
  type SubtitleCache,
  type SubtitleCacheError,
} from '../../core/playback/media-assets.ts'
import type { SubtitleTrackRepository } from '../../core/playback/subtitles.ts'

export type PreExtractSubtitlesError = SubtitleCacheError

export const preExtractSubtitlesFactory =
  ({
    subtitleTracks,
    playableSources,
    mediaCatalog,
    subtitleCache,
    logger,
  }: {
    subtitleTracks: SubtitleTrackRepository
    playableSources: Pick<PlayableSources, 'findSource'>
    mediaCatalog: MediaAssetCatalog
    subtitleCache: SubtitleCache
    logger: Logger
  }) =>
  async ({
    sourceId,
    signal,
  }: {
    sourceId: string
    signal?: AbortSignal
  }): Promise<Result<{ extracted: number }, PreExtractSubtitlesError>> => {
    if (mediaCatalog.libraryFlags(sourceId)?.preExtractSubtitles !== true) {
      return ok({ extracted: 0 })
    }
    const source = playableSources.findSource(sourceId)
    if (source === undefined || source.state !== 'ready' || !source.rootReachable) {
      return ok({ extracted: 0 })
    }
    const tracks = subtitleTracks
      .listForSource(sourceId)
      .flatMap((track) =>
        track.origin === 'embedded' &&
        track.streamIndex !== undefined &&
        isTextSubtitle(track.format)
          ? [{ trackId: track.id, streamIndex: track.streamIndex }]
          : [],
      )
    if (tracks.length === 0) return ok({ extracted: 0 })
    const extracted = await subtitleCache.ensureEmbedded({
      sourceId,
      path: source.path,
      tracks,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!extracted.ok) return extracted
    logger.debug('subtitles extracted', { sourceId, tracks: tracks.length })
    return ok({ extracted: tracks.length })
  }

export type PreExtractSubtitles = ReturnType<typeof preExtractSubtitlesFactory>
