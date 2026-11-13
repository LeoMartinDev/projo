import { appError, type AppError, err, type Result } from '@projo/shared'

import type { PlayableSources } from '../../core/catalog/catalog.ts'
import type { MediaError } from '../../core/media/probe.ts'
import {
  isTextSubtitle,
  type SubtitleCache,
  type SubtitleInput,
} from '../../core/playback/media-assets.ts'
import { isBitmapSubtitle, type SubtitleTrackRepository } from '../../core/playback/subtitles.ts'
import type { SourceAccess } from './shared/source-access.ts'

export type GetSubtitleVttError =
  | AppError<
      | 'playback/subtitle_not_found'
      | 'playback/subtitle_unsupported'
      | 'playback/source_unavailable'
    >
  | MediaError

export const getSubtitleVttFactory =
  ({
    subtitleTracks,
    playableSources,
    canAccessSource,
    subtitleCache,
  }: {
    subtitleTracks: SubtitleTrackRepository
    playableSources: Pick<PlayableSources, 'findSource'>
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
    const source = playableSources.findSource(sourceId)
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
