import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { SegmentCatalog } from '../../core/segments/catalog.ts'
import {
  type SegmentRepository,
  type SegmentType,
  segmentTypes,
} from '../../core/segments/segment.ts'
import type { SegmentSettingsReader } from '../../core/settings/settings.ts'
import { markAbsentFactory, markManualFactory } from './shared/segment-markers.ts'
import type { SegmentTargetOf } from './shared/segment-target.ts'
import { negativeMarkerType } from './shared/segments-view.ts'

export type ApplyToSeasonError = AppError<'item/not_found' | 'segment/not_an_episode'>

export const applySegmentsToSeasonFactory = ({
  segmentTarget,
  segmentCatalog,
  segmentRepository,
  settings,
  jobQueue,
  clock,
  logger,
}: {
  segmentTarget: SegmentTargetOf
  segmentCatalog: Pick<SegmentCatalog, 'listSeasonEpisodeIds'>
  segmentRepository: SegmentRepository
  settings: SegmentSettingsReader
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}) => {
  const markAbsent = markAbsentFactory({ segmentRepository, clock })
  const markManual = markManualFactory({ segmentRepository, settings, jobQueue })

  return ({
    itemId,
    types,
  }: {
    itemId: string
    types?: SegmentType[]
  }): Result<{ updated: number; skipped: number }, ApplyToSeasonError> => {
    const target = segmentTarget(itemId)
    if (!target.ok && target.error.code === 'item/not_found') {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    const seasonId = target.ok ? target.value.ref.seasonId : undefined
    if (!target.ok || target.value.ref.kind !== 'episode' || seasonId === undefined) {
      return err(
        appError('segment/not_an_episode', 'only an episode of a season has a season', {
          context: { itemId },
        }),
      )
    }
    const segments = new Map(segmentRepository.listByItem(itemId).map((s) => [s.type, s]))
    const absent = new Set(
      segmentRepository
        .listLookups(itemId)
        .flatMap((row) => negativeMarkerType(row.provider) ?? []),
    )
    const manualTypes = segmentTypes.filter(
      (type) => segments.get(type)?.origin === 'manual' || absent.has(type),
    )
    const applied = (types ?? manualTypes).filter((type) => manualTypes.includes(type))
    const sourceDurationMs = target.value.ref.durationMs

    let updated = 0
    let skipped = 0
    for (const episodeId of segmentCatalog.listSeasonEpisodeIds(seasonId)) {
      if (episodeId === itemId) continue
      const episode = segmentTarget(episodeId)
      if (!episode.ok) continue
      const episodeSegments = new Map(
        segmentRepository.listByItem(episodeId).map((s) => [s.type, s]),
      )
      const episodeAbsent = new Set(
        segmentRepository
          .listLookups(episodeId)
          .flatMap((row) => negativeMarkerType(row.provider) ?? []),
      )
      const durationMs = episode.value.ref.durationMs
      let changed = false
      for (const type of applied) {
        if (episodeSegments.get(type)?.origin === 'manual' || episodeAbsent.has(type)) continue
        const segment = segments.get(type)
        if (absent.has(type) || segment === undefined) {
          markAbsent(episodeId, type)
          changed = true
          continue
        }
        const shift =
          (type === 'credits' || type === 'preview') &&
          durationMs !== undefined &&
          sourceDurationMs !== undefined
            ? durationMs - sourceDurationMs
            : 0
        const startMs = Math.max(0, segment.startMs + shift)
        const endMs =
          durationMs === undefined
            ? segment.endMs + shift
            : Math.min(segment.endMs + shift, durationMs)
        if (endMs <= startMs) continue
        markManual(episodeId, type, startMs, endMs)
        changed = true
      }
      if (changed) updated += 1
      else skipped += 1
    }
    logger.info('segment markers applied to the season', { itemId, seasonId, types: applied })
    return ok({ updated, skipped })
  }
}

export type ApplySegmentsToSeason = ReturnType<typeof applySegmentsToSeasonFactory>
