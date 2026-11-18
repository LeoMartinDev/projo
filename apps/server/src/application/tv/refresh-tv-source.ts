import { ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvLogoFiles } from '../../core/tv/logo.ts'
import type { TvProviderError, TvSourceProvider } from '../../core/tv/provider.ts'
import { planTvRefresh } from '../../core/tv/refresh-plan.ts'
import { TV_SOURCE_FAILURES_BEFORE_NOTICE, type TvSourceRepository } from '../../core/tv/source.ts'
import { queueTvGuide, queueTvLogos } from './shared/tv-jobs.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById' | 'recordSuccess' | 'recordFailure'>
  tvChannels: Pick<TvChannelRepository, 'stateOf' | 'applyRefresh'>
  provider: Pick<TvSourceProvider, 'listChannels'>
  logoFiles: Pick<TvLogoFiles, 'remove'>
  notifier: AdminNotifier
  jobQueue: JobQueue
  ids: IdGenerator
  clock: Clock
  logger: Logger
}

export type RefreshTvSourceError = TvProviderError

export type TvRefreshSummary = {
  listed: number
  added: number
  updated: number
  missing: number
  deleted: number
}

/**
 * `refresh_tv_source` (§29.2): lists the source's channels and applies them (identity by key,
 * missing then deleted after 7 days, groups). A failure changes no channel: it is counted on the
 * source, which raises `tv/source_unreachable` at the third in a row; a success resolves it.
 * A source deleted meanwhile is skipped (`undefined`).
 */
export const refreshTvSourceFactory =
  ({ tvSources, tvChannels, provider, logoFiles, notifier, jobQueue, ids, clock, logger }: Deps) =>
  async ({
    sourceId,
    signal,
  }: {
    sourceId: string
    signal?: AbortSignal
  }): Promise<Result<TvRefreshSummary | undefined, RefreshTvSourceError>> => {
    const source = tvSources.findById(sourceId)
    if (source === undefined) {
      logger.info('tv source gone, refresh skipped', { tvSourceId: sourceId })
      return ok(undefined)
    }
    const listing = await provider.listChannels({
      settings: source.settings,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!listing.ok) {
      // Stopping the server is not the provider's failure.
      if (signal?.aborted === true) return listing
      const failures = tvSources.recordFailure({
        id: sourceId,
        at: clock.now(),
        error: { code: listing.error.code, message: listing.error.message },
      })
      logger.warn('tv source refresh failed', {
        code: listing.error.code,
        tvSourceId: sourceId,
        failures,
        ...listing.error.context,
      })
      if (failures >= TV_SOURCE_FAILURES_BEFORE_NOTICE) {
        notifier.notify({
          kind: 'tv/source_unreachable',
          severity: 'warning',
          key: sourceId,
          context: {
            tvSourceId: sourceId,
            name: source.name,
            code: listing.error.code,
            failures,
          },
        })
      }
      return listing
    }
    if (tvSources.findById(sourceId) === undefined) return ok(undefined)

    const now = clock.now()
    const state = tvChannels.stateOf(sourceId)
    const plan = planTvRefresh({
      sourceId,
      groups: state.groups,
      channels: state.channels,
      listing: listing.value.channels,
      now,
      newId: () => ids.next(),
    })
    tvChannels.applyRefresh(plan)
    tvSources.recordSuccess({
      id: sourceId,
      at: now,
      ...(listing.value.guideUrl === undefined
        ? {}
        : { discoveredGuideUrl: listing.value.guideUrl }),
      ...(listing.value.account === undefined ? {} : { account: listing.value.account }),
    })
    notifier.resolve({ kind: 'tv/source_unreachable', key: sourceId })

    const deleted = new Set(plan.channels.delete)
    const logos = state.channels.flatMap((channel) =>
      deleted.has(channel.id) && channel.logoPath !== undefined ? [channel.logoPath] : [],
    )
    await Promise.all(logos.map((path) => logoFiles.remove(path)))
    queueTvLogos(jobQueue, sourceId)
    queueTvGuide(jobQueue, sourceId)

    const summary: TvRefreshSummary = {
      listed: listing.value.channels.length,
      added: plan.channels.insert.length,
      updated: plan.channels.update.length,
      missing: plan.channels.markMissing.ids.length,
      deleted: deleted.size,
    }
    logger.info('tv source refreshed', { tvSourceId: sourceId, ...summary })
    return ok(summary)
  }

export type RefreshTvSource = ReturnType<typeof refreshTvSourceFactory>
