import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import {
  type TvChannel,
  type TvChannelRepository,
  TV_LOGO_RETRY_MS,
} from '../../core/tv/channel.ts'
import {
  type TvLogoDownloader,
  type TvLogoError,
  type TvLogoFiles,
  tvLogoPathOf,
} from '../../core/tv/logo.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById'>
  tvChannels: Pick<TvChannelRepository, 'logoWork' | 'recordLogo' | 'dropLogo'>
  downloader: TvLogoDownloader
  logoFiles: Pick<TvLogoFiles, 'write' | 'remove'>
  clock: Clock
  logger: Logger
  concurrency?: number
}

export type TvLogosSummary = { fetched: number; failed: number; dropped: number }

/** The job was stopped (server shutdown): the runner releases it for the next start. */
export type FetchTvLogosError = AppError<'job/cancelled'>

/**
 * `fetch_tv_logos` (§29.2): downloads the logos of the source's enabled channels that have none
 * yet, whose URL changed, or whose last attempt failed a day ago; forgets those the source no
 * longer gives. A failed logo is logged and tried again later, never failing the job; a channel
 * that failed keeps serving its previous logo. A file written for a channel deleted meanwhile
 * (its source deleted, or a refresh) is removed. Stopped by `signal`, it fails `job/cancelled`.
 */
export const fetchTvLogosFactory =
  ({ tvSources, tvChannels, downloader, logoFiles, clock, logger, concurrency = 4 }: Deps) =>
  async ({
    sourceId,
    signal,
  }: {
    sourceId: string
    signal?: AbortSignal
  }): Promise<Result<TvLogosSummary, FetchTvLogosError>> => {
    const source = tvSources.findById(sourceId)
    if (source === undefined) return ok({ fetched: 0, failed: 0, dropped: 0 })
    const work = tvChannels.logoWork({
      sourceId,
      retryFailedBefore: new Date(clock.now().getTime() - TV_LOGO_RETRY_MS),
    })

    for (const channel of work.drop) {
      tvChannels.dropLogo(channel.id)
      if (channel.logoPath !== undefined) await logoFiles.remove(channel.logoPath)
    }

    let fetched = 0
    let failed = 0
    const fetchOne = async (channel: TvChannel & { logoUrl: string }) => {
      const userAgent = channel.upstream.userAgent ?? source.settings.userAgent
      const logo = await downloader.download({
        url: channel.logoUrl,
        ...(userAgent === undefined ? {} : { userAgent }),
        ...(signal === undefined ? {} : { signal }),
      })
      if (signal?.aborted === true) return
      const fail = (error: TvLogoError) => {
        failed += 1
        logger.debug('tv logo not fetched', {
          tvChannelId: channel.id,
          code: error.code,
          ...error.context,
        })
        tvChannels.recordLogo({ id: channel.id, url: channel.logoUrl, at: clock.now() })
      }
      if (!logo.ok) return fail(logo.error)
      const path = tvLogoPathOf(channel.id, logo.value.type)
      const written = await logoFiles.write({ path, bytes: logo.value.bytes })
      if (!written.ok) return fail(written.error)
      if (!tvChannels.recordLogo({ id: channel.id, url: channel.logoUrl, at: clock.now(), path })) {
        await logoFiles.remove(path)
        return
      }
      if (channel.logoPath !== undefined && channel.logoPath !== path)
        await logoFiles.remove(channel.logoPath)
      fetched += 1
    }

    const queue = work.fetch.flatMap((channel) =>
      channel.logoUrl === undefined ? [] : [{ ...channel, logoUrl: channel.logoUrl }],
    )
    const worker = async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (signal?.aborted === true) return
        await fetchOne(next)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
    if (signal?.aborted === true)
      return err(
        appError('job/cancelled', 'tv logo fetch interrupted', {
          context: { tvSourceId: sourceId },
        }),
      )

    const summary = { fetched, failed, dropped: work.drop.length }
    if (fetched + failed + summary.dropped > 0)
      logger.info('tv logos fetched', { tvSourceId: sourceId, ...summary })
    return ok(summary)
  }

export type FetchTvLogos = ReturnType<typeof fetchTvLogosFactory>
