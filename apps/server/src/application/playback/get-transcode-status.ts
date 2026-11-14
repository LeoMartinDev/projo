import { ok, type Result } from '@projo/shared'

import type { TranscodeRunInspector, TranscodeRunStatus } from '../../core/playback/ports.ts'
import type { AuthorizePlayback } from './authorize-playback.ts'
import type { PlaybackAccess, SessionAccessError } from './shared/session-access.ts'

/**
 * What the server's ffmpeg does for a session right now (§10.7 playback info): nothing for a
 * `direct` session or before its first segment, else the run's acceleration, preset and speed.
 */
export const getTranscodeStatusFactory =
  ({
    authorize,
    transcodeRuns,
  }: {
    authorize: AuthorizePlayback
    transcodeRuns: TranscodeRunInspector
  }) =>
  (access: PlaybackAccess): Result<TranscodeRunStatus, SessionAccessError> => {
    const session = authorize(access)
    if (!session.ok) return session
    if (session.value.mode === 'direct') return ok({ running: false })
    return ok(transcodeRuns.inspect(session.value.id) ?? { running: false })
  }

export type GetTranscodeStatus = ReturnType<typeof getTranscodeStatusFactory>
