import { appError, err, ok } from '@projo/shared'

import {
  type CatalogRepository,
  isPlayableKind,
  type VisibilityScopeResolver,
} from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { SegmentCatalog } from '../../core/segments/catalog.ts'
import { itemTimeline } from '../../core/segments/chapters.ts'
import {
  noSegmentKey,
  type SegmentRepository,
  type SegmentType,
  segmentTypes,
} from '../../core/segments/segment.ts'
import type { SegmentSettingsReader } from '../../core/settings/settings.ts'
import {
  negativeMarkerType,
  requestSegments,
  requestSubmission,
  type SegmentTargetOf,
  segmentsView,
} from './targets.ts'
import type {
  ApplySegmentsToSeason,
  GetItemSegments,
  RemoveSegment,
  SetManualSegment,
} from './types.ts'

/** `GET /items/:id/segments`: a movie or an episode the profile sees (§14). */
export const getItemSegmentsFactory =
  ({
    catalogRepository,
    segmentRepository,
    visibilityScope,
  }: {
    catalogRepository: Pick<CatalogRepository, 'findVisible' | 'listReadySources'>
    segmentRepository: SegmentRepository
    visibilityScope: VisibilityScopeResolver
  }): GetItemSegments =>
  ({ itemId, profileId, withLookups }) => {
    const scope = visibilityScope(profileId)
    const item = catalogRepository.findVisible({ id: itemId, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    if (!isPlayableKind(item.kind)) {
      return err(
        appError('item/invalid_kind', 'segments exist on movies and episodes', {
          context: { itemId, kind: item.kind },
        }),
      )
    }
    const { durationMs } = itemTimeline(catalogRepository.listReadySources({ itemId, scope }))
    return ok(
      segmentsView(segmentRepository, {
        itemId,
        ...(durationMs === undefined ? {} : { durationMs }),
        withLookups,
      }),
    )
  }

type MarkerDeps = {
  segmentTarget: SegmentTargetOf
  segmentCatalog: Pick<SegmentCatalog, 'listSeasonEpisodeIds'>
  segmentRepository: SegmentRepository
  settings: SegmentSettingsReader
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

/**
 * Manual markers (§12.5): `PUT`, `DELETE` and "Apply to the whole season". A manual segment
 * outranks every other origin; a negative marker (`{ absent: true }`, `no_segment:<type>`)
 * removes the segment of its type and stops the chain for it. Contribution (`manual_only`)
 * submits each new manual segment (`submit_segment`).
 */
export const segmentMarkersFactory = ({
  segmentTarget,
  segmentCatalog,
  segmentRepository,
  settings,
  jobQueue,
  clock,
  logger,
}: MarkerDeps) => {
  const view = (itemId: string, durationMs: number | undefined) =>
    segmentsView(segmentRepository, {
      itemId,
      ...(durationMs === undefined ? {} : { durationMs }),
      withLookups: true,
    })

  const contribute = (itemId: string, type: SegmentType) => {
    if (settings.read().contribution === 'manual_only') requestSubmission(jobQueue, itemId, type)
  }

  const markAbsent = (itemId: string, type: SegmentType) => {
    segmentRepository.remove({ itemId, type })
    segmentRepository.saveLookup({
      itemId,
      provider: noSegmentKey(type),
      checkedAt: clock.now(),
      outcome: 'no_segment',
    })
  }

  const markManual = (itemId: string, type: SegmentType, startMs: number, endMs: number) => {
    segmentRepository.removeLookup({ itemId, provider: noSegmentKey(type) })
    segmentRepository.save({ itemId, origin: 'manual', candidate: { type, startMs, endMs } })
    contribute(itemId, type)
  }

  const setManualSegment: SetManualSegment = ({ itemId, type, marker }) => {
    const target = segmentTarget(itemId)
    if (!target.ok) return err(target.error)
    const { durationMs } = target.value.ref
    if ('absent' in marker) {
      markAbsent(itemId, type)
      logger.info('negative segment marker set', { itemId, type })
      return ok(view(itemId, durationMs))
    }
    const { startMs, endMs } = marker
    if (startMs < 0 || endMs <= startMs || (durationMs !== undefined && endMs > durationMs)) {
      return err(
        appError('segment/invalid_range', 'segment outside the item duration', {
          context: { startMs, endMs, ...(durationMs === undefined ? {} : { durationMs }) },
        }),
      )
    }
    markManual(itemId, type, startMs, endMs)
    logger.info('manual segment set', { itemId, type, startMs, endMs })
    return ok(view(itemId, durationMs))
  }

  const removeSegment: RemoveSegment = ({ itemId, type }) => {
    const target = segmentTarget(itemId)
    if (!target.ok) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    const lookups = segmentRepository.listLookups(itemId)
    const hadMarker = lookups.some((row) => row.provider === noSegmentKey(type))
    const removed = segmentRepository.remove({ itemId, type })
    if (!removed && !hadMarker) {
      return err(
        appError('segment/not_found', 'no segment of that type', { context: { itemId, type } }),
      )
    }
    segmentRepository.removeLookup({ itemId, provider: noSegmentKey(type) })
    // The chain runs again from scratch for this item (negative markers of other types stay).
    for (const row of lookups) {
      if (negativeMarkerType(row.provider) === undefined) {
        segmentRepository.removeLookup({ itemId, provider: row.provider })
      }
    }
    requestSegments(jobQueue, itemId)
    logger.info('segment removed', { itemId, type })
    return ok(view(itemId, target.value.ref.durationMs))
  }

  const applyToSeason: ApplySegmentsToSeason = ({ itemId, types }) => {
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
        // "except those already manual" (§12.2 row 1): a manual segment or a negative marker.
        if (episodeSegments.get(type)?.origin === 'manual' || episodeAbsent.has(type)) continue
        const segment = segments.get(type)
        if (absent.has(type) || segment === undefined) {
          markAbsent(episodeId, type)
          changed = true
          continue
        }
        // A shorter episode keeps what fits of the marker.
        const endMs = durationMs === undefined ? segment.endMs : Math.min(segment.endMs, durationMs)
        if (endMs <= segment.startMs) continue
        markManual(episodeId, type, segment.startMs, endMs)
        changed = true
      }
      if (changed) updated += 1
      else skipped += 1
    }
    logger.info('segment markers applied to the season', { itemId, seasonId, types: applied })
    return ok({ updated, skipped })
  }

  return { setManualSegment, removeSegment, applyToSeason }
}
