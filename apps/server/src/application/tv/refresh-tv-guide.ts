import { ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import {
  createGuideCollector,
  type TvGuideError,
  type TvGuideRepository,
} from '../../core/tv/guide.ts'
import type { TvSourceProvider } from '../../core/tv/provider.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById' | 'recordGuideAttempt'>
  tvChannels: Pick<TvChannelRepository, 'guideTargetsOf'>
  guide: Pick<TvGuideRepository, 'replaceForSource'>
  provider: Pick<TvSourceProvider, 'readGuide'>
  /** The server's metadata language (§9): the guide's texts are picked in it (§29.3). */
  guideLanguage: () => string
  clock: Clock
  logger: Logger
}

export type RefreshTvGuideError = TvGuideError

export type TvGuideSummary = { channels: number; programmes: number; available: boolean }

/**
 * `refresh_tv_guide` (§29.3): reads the source's guide as a stream, keeps the programmes of its
 * enabled channels from now to 24 hours ahead, and replaces the stored ones. A source without
 * an enabled channel or without a guide keeps none; a failed read changes nothing. A source
 * deleted meanwhile is skipped (`undefined`).
 */
export const refreshTvGuideFactory =
  ({ tvSources, tvChannels, guide, provider, guideLanguage, clock, logger }: Deps) =>
  async ({
    sourceId,
    signal,
  }: {
    sourceId: string
    signal?: AbortSignal
  }): Promise<Result<TvGuideSummary | undefined, RefreshTvGuideError>> => {
    const source = tvSources.findById(sourceId)
    if (source === undefined) {
      logger.info('tv source gone, guide refresh skipped', { tvSourceId: sourceId })
      return ok(undefined)
    }
    tvSources.recordGuideAttempt({ id: sourceId, at: clock.now() })
    const channels = tvChannels.guideTargetsOf(sourceId)
    if (channels.length === 0) {
      guide.replaceForSource({ sourceId, programmes: [], now: clock.now() })
      return ok({ channels: 0, programmes: 0, available: false })
    }
    const collector = createGuideCollector({
      channels,
      now: clock.now(),
      language: guideLanguage(),
    })
    const read = await provider.readGuide({
      source,
      sink: collector.sink,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!read.ok) {
      if (signal?.aborted !== true)
        logger.warn('tv guide refresh failed', {
          code: read.error.code,
          tvSourceId: sourceId,
          ...read.error.context,
        })
      return read
    }
    if (tvSources.findById(sourceId) === undefined) return ok(undefined)
    const programmes = collector.finish()
    guide.replaceForSource({ sourceId, programmes, now: clock.now() })
    const summary: TvGuideSummary = {
      channels: new Set(programmes.map((programme) => programme.channelId)).size,
      programmes: programmes.length,
      available: read.value.available,
    }
    logger.info('tv guide refreshed', { tvSourceId: sourceId, ...summary })
    return ok(summary)
  }

export type RefreshTvGuide = ReturnType<typeof refreshTvGuideFactory>
