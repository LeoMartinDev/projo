import type { Result } from '@projo/shared'

import type { AuthorizeLiveStream, LiveStreamAccess } from './authorize-live-stream.ts'
import type { EndLiveSession } from './end-live-session.ts'
import type { LiveStreamError, LiveStreams } from './live-streams.ts'
import type { LiveSessionNotFound } from './shared/live-session-errors.ts'

export type GetLivePlaylistError = LiveSessionNotFound | LiveStreamError

/**
 * The live playlist of the session's rendition under its capability URL; a failed stream ends
 * the session.
 */
export const getLivePlaylistFactory =
  ({
    authorize,
    streams,
    endLiveSession,
  }: {
    authorize: AuthorizeLiveStream
    streams: Pick<LiveStreams, 'playlist' | 'isAvailable'>
    endLiveSession: EndLiveSession
  }) =>
  ({
    from,
    ...access
  }: LiveStreamAccess & {
    /** The window from this segment on (§29.4: a player that cannot seek in a live playlist). */
    from?: number
  }): Result<string, GetLivePlaylistError> => {
    const session = authorize(access)
    if (!session.ok) return session
    const { channelId, rendition } = session.value
    const playlist = streams.playlist({
      channelId,
      rendition,
      ...(from === undefined ? {} : { from }),
    })
    if (!playlist.ok && !streams.isAvailable({ channelId, rendition })) {
      endLiveSession({ session: session.value, reason: 'ended' })
    }
    return playlist
  }

export type GetLivePlaylist = ReturnType<typeof getLivePlaylistFactory>
