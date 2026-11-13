import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { TmdbResponsePurge } from '../../core/metadata/ports.ts'

export const TMDB_RESPONSE_RETENTION_MS = 30 * 24 * 60 * 60_000

export const purgeTmdbResponsesFactory =
  ({ responses, clock, logger }: { responses: TmdbResponsePurge; clock: Clock; logger: Logger }) =>
  (): { deleted: number } => {
    const deleted = responses.purgeFetchedBefore(
      new Date(clock.now().getTime() - TMDB_RESPONSE_RETENTION_MS),
    )
    if (deleted > 0) logger.info('old TMDB responses purged', { deleted })
    return { deleted }
  }

export type PurgeTmdbResponses = ReturnType<typeof purgeTmdbResponsesFactory>
