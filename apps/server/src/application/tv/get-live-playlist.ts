import type { Result } from '@projo/shared'

import type { AuthorizeLiveStream, LiveStreamAccess } from './authorize-live-stream.ts'
import type { EndLiveSession } from './end-live-session.ts'
import type { LiveStreamError, LiveStreams } from './live-streams.ts'
import type { LiveSessionNotFound } from './shared/live-session-errors.ts'

export type GetLivePlaylistError = LiveSessionNotFound | LiveStreamError

/** The live playlist under a session's capability URL; a failed stream ends the session. */
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
  (access: LiveStreamAccess): Result<string, GetLivePlaylistError> => {
    const session = authorize(access)
    if (!session.ok) return session
    const playlist = streams.playlist(session.value.channelId)
    if (!playlist.ok && !streams.isAvailable(session.value.channelId)) {
      endLiveSession({ session: session.value, reason: 'ended' })
    }
    return playlist
  }

export type GetLivePlaylist = ReturnType<typeof getLivePlaylistFactory>
