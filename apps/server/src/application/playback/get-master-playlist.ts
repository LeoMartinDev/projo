import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import { subtitleRenditionNames } from '@projo/shared/api/playback'

import type { PlayableSources } from '../../core/catalog/catalog.ts'
import { renderMasterPlaylist } from '../../core/playback/hls-playlist.ts'
import { isBitmapSubtitle, type SubtitleTrackRepository } from '../../core/playback/subtitles.ts'
import type { AuthorizeStream, StreamAccess } from './authorize-stream.ts'
import type { SessionAccessError } from './shared/session-access.ts'

export type GetMasterPlaylistError = SessionAccessError | AppError<'playback/mode_unsupported'>

export const getMasterPlaylistFactory =
  ({
    authorize,
    playableSources,
    subtitleTrackRepository,
  }: {
    authorize: AuthorizeStream
    playableSources: Pick<PlayableSources, 'findSource'>
    subtitleTrackRepository: Pick<SubtitleTrackRepository, 'listForSource'>
  }) =>
  (input: StreamAccess & { subtitleOffsetMs: number }): Result<string, GetMasterPlaylistError> => {
    const session = authorize(input)
    if (!session.ok) return session
    const { sourceId, subtitleTrackId, mode } = session.value
    const source = playableSources.findSource(sourceId)
    if (mode === 'direct' || source === undefined) {
      return err(
        appError('playback/mode_unsupported', 'not an HLS session', {
          context: { sessionId: input.sessionId, mode },
        }),
      )
    }
    const tracks = subtitleTrackRepository
      .listForSource(sourceId)
      .filter((track) => !isBitmapSubtitle(track))
    const names = subtitleRenditionNames(tracks)
    const durationS = (source.media?.durationMs ?? 0) / 1000
    return ok(
      renderMasterPlaylist({
        bandwidth: durationS > 0 ? (source.sizeBytes * 8) / durationS : 8_000_000,
        subtitles: tracks.map((track, index) => ({
          id: track.id,
          name: names[index] ?? track.id,
          ...(track.language === undefined ? {} : { language: track.language }),
          forced: track.forced,
          sdh: track.sdh,
          selected: track.id === subtitleTrackId,
        })),
        subtitleOffsetMs: input.subtitleOffsetMs,
      }),
    )
  }

export type GetMasterPlaylist = ReturnType<typeof getMasterPlaylistFactory>
