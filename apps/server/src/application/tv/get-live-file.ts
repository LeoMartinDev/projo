import type { Result } from '@projo/shared'

import type { AuthorizeLiveStream, LiveStreamAccess } from './authorize-live-stream.ts'
import type { EndLiveSession } from './end-live-session.ts'
import type { LiveFileError, LiveStreams } from './live-streams.ts'
import type { LiveSessionNotFound } from './shared/live-session-errors.ts'

export type GetLiveFileError = LiveSessionNotFound | LiveFileError

/**
 * A live init or segment file under a session's capability URL (§29.4); a failed stream ends
 * the session, like the playlist request.
 */
export const getLiveFileFactory =
  ({
    authorize,
    streams,
    endLiveSession,
  }: {
    authorize: AuthorizeLiveStream
    streams: Pick<LiveStreams, 'file' | 'isAvailable'>
    endLiveSession: EndLiveSession
  }) =>
  ({ name, ...access }: LiveStreamAccess & { name: string }): Result<string, GetLiveFileError> => {
    const session = authorize(access)
    if (!session.ok) return session
    const { channelId, rendition } = session.value
    const file = streams.file({ channelId, rendition, name })
    if (!file.ok && !streams.isAvailable({ channelId, rendition })) {
      endLiveSession({ session: session.value, reason: 'ended' })
    }
    return file
  }

export type GetLiveFile = ReturnType<typeof getLiveFileFactory>
