import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvLogoDownloader, TvLogoFiles } from '../../core/tv/logo.ts'
import {
  TV_PROGRAMME_IMAGE_REFRESH_MS,
  TV_PROGRAMME_IMAGE_RETRY_MS,
  type TvProgrammeImageRepository,
  type TvProgrammeImageWork,
  tvProgrammeImagePathOf,
} from '../../core/tv/programme-image.ts'
import { type TvSourceRepository, userAgentOf } from '../../core/tv/source.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById'>
  images: Pick<TvProgrammeImageRepository, 'work' | 'record' | 'pathOf'>
  /** The logos' downloader, with the programme images' size limit (§29.3). */
  downloader: TvLogoDownloader
  files: Pick<TvLogoFiles, 'write' | 'remove'>
  clock: Clock
  logger: Logger
  concurrency?: number
}

export type TvProgrammeImagesSummary = { fetched: number; failed: number }

/** The job was stopped (server shutdown): the runner releases it for the next start. */
export type FetchTvProgrammeImagesError = AppError<'job/cancelled'>

/**
 * `fetch_tv_programme_images` (§29.3): downloads the images of the programmes on now and next of
 * enabled channels that have none stored, failed 6 hours ago, or were fetched 7 days ago, under
 * the logos' rules, once per URL. A failure is logged with the host and a fixed reason (never the
 * URL) and tried again later; it never fails the job. Stopped by `signal`, it fails
 * `job/cancelled`.
 */
export const fetchTvProgrammeImagesFactory =
  ({ tvSources, images, downloader, files, clock, logger, concurrency = 4 }: Deps) =>
  async ({ signal }: { signal?: AbortSignal } = {}): Promise<
    Result<TvProgrammeImagesSummary, FetchTvProgrammeImagesError>
  > => {
    const now = clock.now()
    const queue = images.work({
      at: now,
      retryFailedBefore: new Date(now.getTime() - TV_PROGRAMME_IMAGE_RETRY_MS),
      refetchBefore: new Date(now.getTime() - TV_PROGRAMME_IMAGE_REFRESH_MS),
    })
    let fetched = 0
    let failed = 0
    const fetchOne = async ({ key, url, sourceId }: TvProgrammeImageWork) => {
      const source = tvSources.findById(sourceId)
      if (source === undefined) return
      const userAgent = userAgentOf(source.settings)
      const image = await downloader.download({
        url,
        ...(userAgent === undefined ? {} : { userAgent }),
        ...(signal === undefined ? {} : { signal }),
      })
      if (signal?.aborted === true) return
      const fail = (context: Record<string, unknown> | undefined) => {
        failed += 1
        // The host and a fixed reason only: a guide's URL may carry the provider's secret.
        logger.debug('tv programme image not fetched', {
          tvSourceId: sourceId,
          host: context?.['host'],
          reason: context?.['reason'],
        })
        images.record({ key, at: clock.now() })
      }
      if (!image.ok) return fail(image.error.context)
      const path = tvProgrammeImagePathOf(key, image.value.type)
      const previous = images.pathOf(key)
      const written = await files.write({ path, bytes: image.value.bytes })
      if (!written.ok) return fail({ reason: 'write_failed' })
      images.record({ key, at: clock.now(), path })
      if (previous !== undefined && previous !== path) await files.remove(previous)
      fetched += 1
    }
    const worker = async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (signal?.aborted === true) return
        await fetchOne(next)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
    if (signal?.aborted === true)
      return err(appError('job/cancelled', 'tv programme images fetch interrupted'))
    const summary = { fetched, failed }
    if (fetched + failed > 0) logger.info('tv programme images fetched', summary)
    return ok(summary)
  }

export type FetchTvProgrammeImages = ReturnType<typeof fetchTvProgrammeImagesFactory>
