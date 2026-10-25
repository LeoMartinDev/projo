import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogRepository } from '../../core/catalog/catalog.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MediaError } from '../../core/media/probe.ts'
import {
  isTextSubtitle,
  type MediaAssetCatalog,
  type SubtitleCache,
  type SubtitleInput,
} from '../../core/playback/media-assets.ts'
import { isBitmapSubtitle, type SubtitleTrackRepository } from '../../core/playback/subtitles.ts'

/** §14 / §20: the source plays an item the profile sees (library access, maximum rating). */
export type SourceAccess = (input: { sourceId: string; profileId: string }) => boolean

export type GetSubtitleVttError =
  | AppError<
      | 'playback/subtitle_not_found'
      | 'playback/subtitle_unsupported'
      | 'playback/source_unavailable'
    >
  | MediaError

/**
 * `GET /subtitles/:sourceId/:trackId.vtt` (§10.4): a text track of a source the profile may play,
 * as WebVTT, converted (external `srt ass ssa vtt`) or extracted (embedded `srt ass ssa vtt
 * mov_text`) on the first request, then served from the cache. A bitmap track is burnt in, never
 * sent: `playback/subtitle_unsupported`.
 */
export const getSubtitleVttFactory =
  ({
    subtitleTracks,
    catalogRepository,
    canAccessSource,
    subtitleCache,
  }: {
    subtitleTracks: SubtitleTrackRepository
    catalogRepository: CatalogRepository
    canAccessSource: SourceAccess
    subtitleCache: SubtitleCache
  }) =>
  async ({
    sourceId,
    trackId,
    profileId,
    signal,
  }: {
    sourceId: string
    trackId: string
    profileId: string
    signal?: AbortSignal
  }): Promise<Result<string, GetSubtitleVttError>> => {
    const track = subtitleTracks.findById(trackId)
    // A track of another source, or of a source this profile does not see, does not exist.
    if (
      track === undefined ||
      track.sourceId !== sourceId ||
      !canAccessSource({ sourceId, profileId })
    ) {
      return err(
        appError('playback/subtitle_not_found', 'subtitle track not found', {
          context: { sourceId, trackId },
        }),
      )
    }
    if (isBitmapSubtitle(track) || !isTextSubtitle(track.format)) {
      return err(
        appError('playback/subtitle_unsupported', 'bitmap subtitles are burnt in, not sent', {
          context: { trackId, format: track.format },
        }),
      )
    }
    const source = catalogRepository.findSource(sourceId)
    if (source === undefined || source.state !== 'ready' || !source.rootReachable) {
      return err(
        appError('playback/source_unavailable', 'source unavailable', { context: { sourceId } }),
      )
    }
    const input: SubtitleInput | undefined =
      track.origin === 'external'
        ? track.path === undefined
          ? undefined
          : { kind: 'external', path: track.path, format: track.format }
        : track.streamIndex === undefined
          ? undefined
          : { kind: 'embedded', path: source.path, streamIndex: track.streamIndex }
    if (input === undefined) {
      return err(
        appError('playback/subtitle_not_found', 'subtitle track has no input', {
          context: { sourceId, trackId },
        }),
      )
    }
    return subtitleCache.ensure({
      sourceId,
      trackId,
      input,
      ...(signal === undefined ? {} : { signal }),
    })
  }

export type GetSubtitleVtt = ReturnType<typeof getSubtitleVttFactory>

export const extractSubtitlesDedupeKey = (sourceId: string) => `subtitles:${sourceId}`

/** §7.1 `pre_extract_subtitles`: queued after the probe of a source of such a library. */
export const requestSubtitleExtraction = (jobQueue: JobQueue, sourceId: string): void => {
  jobQueue.enqueue({
    type: 'extract_subtitles',
    payload: { sourceId },
    dedupeKey: extractSubtitlesDedupeKey(sourceId),
  })
}

/**
 * Job `extract_subtitles`: every embedded text track of the source to WebVTT, in one ffmpeg pass,
 * so the first playback finds them ready. Nothing to do when the library stopped asking for it, or
 * when the source is gone or no longer ready.
 */
export const preExtractSubtitlesFactory =
  ({
    subtitleTracks,
    catalogRepository,
    mediaCatalog,
    subtitleCache,
    logger,
  }: {
    subtitleTracks: SubtitleTrackRepository
    catalogRepository: CatalogRepository
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
  }): Promise<Result<{ extracted: number }, GetSubtitleVttError>> => {
    if (mediaCatalog.libraryFlags(sourceId)?.preExtractSubtitles !== true) {
      return ok({ extracted: 0 })
    }
    const source = catalogRepository.findSource(sourceId)
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
