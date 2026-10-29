import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogRepository } from '../../core/catalog/catalog.ts'
import { directMimeType } from '../../core/playback/decide-mode.ts'
import type { AuthorizeStream, SessionAccessError, StreamAccess } from './session-lifecycle.ts'

export type DirectStreamError =
  SessionAccessError | AppError<'playback/source_unavailable' | 'playback/mode_unsupported'>

/**
 * `GET /stream/:sessionId/:secret/direct` (§10.2 `direct`, §20): the file of an active `direct`
 * session, nothing else, while the source is `ready` (a file being replaced is not).
 */
export const directStreamFactory =
  ({
    authorize,
    catalogRepository,
  }: {
    authorize: AuthorizeStream
    catalogRepository: CatalogRepository
  }) =>
  async (
    access: StreamAccess,
  ): Promise<Result<{ path: string; mimeType: string }, DirectStreamError>> => {
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
    const source = catalogRepository.findSource(sourceId)
    const mimeType = source === undefined ? undefined : directMimeType(source.extension)
    if (
      source === undefined ||
      source.state !== 'ready' ||
      !source.rootReachable ||
      mimeType === undefined
    ) {
      return err(
        appError('playback/source_unavailable', 'source unavailable', { context: { sourceId } }),
      )
    }
    return ok({ path: source.path, mimeType })
  }

export type DirectStream = ReturnType<typeof directStreamFactory>
