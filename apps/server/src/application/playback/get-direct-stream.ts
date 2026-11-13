import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { PlayableSources } from '../../core/catalog/catalog.ts'
import { fileMimeType } from '../../core/playback/decide-mode.ts'
import type { AuthorizeStream, StreamAccess } from './authorize-stream.ts'
import type { SessionAccessError } from './shared/session-access.ts'

export type GetDirectStreamError =
  SessionAccessError | AppError<'playback/source_unavailable' | 'playback/mode_unsupported'>

export const getDirectStreamFactory =
  ({
    authorize,
    playableSources,
  }: {
    authorize: AuthorizeStream
    playableSources: Pick<PlayableSources, 'findSource'>
  }) =>
  async (
    access: StreamAccess,
  ): Promise<Result<{ path: string; mimeType: string }, GetDirectStreamError>> => {
    const { sessionId } = access
    const session = authorize(access)
    if (!session.ok) return session
    const { sourceId, mode } = session.value
    if (mode !== 'direct') {
      return err(
        appError('playback/mode_unsupported', 'this session does not stream this file directly', {
          context: { sessionId, sourceId },
        }),
      )
    }
    const source = playableSources.findSource(sourceId)
    if (source === undefined || source.state !== 'ready' || !source.rootReachable) {
      return err(
        appError('playback/source_unavailable', 'source unavailable', { context: { sourceId } }),
      )
    }
    return ok({ path: source.path, mimeType: fileMimeType(source.extension) })
  }

export type GetDirectStream = ReturnType<typeof getDirectStreamFactory>
