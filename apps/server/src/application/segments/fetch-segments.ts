import { ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import { chapterSegments } from '../../core/segments/chapters.ts'
import {
  isLookupFresh,
  type SegmentCandidate,
  type SegmentItemRef,
  type SegmentOrigin,
  type SegmentProvider,
  type SegmentProviderId,
  type SegmentRepository,
  type SegmentType,
  segmentTypes,
} from '../../core/segments/segment.ts'
import type { SegmentSettingsReader } from '../../core/settings/settings.ts'
import { negativeMarkerType, type SegmentTargetOf } from './targets.ts'

type Deps = {
  segmentTarget: SegmentTargetOf
  segmentRepository: SegmentRepository
  providers: Record<SegmentProviderId, SegmentProvider>
  settings: SegmentSettingsReader
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

export type FetchSegmentsOutcome = 'skipped' | 'disabled' | 'resolved'

/**
 * Origins that settle a type for the chain: a stored segment of one of them is not asked again
 * (manual and chapters by priority, a community one because the first provider wins, §12.2).
 * A fingerprint segment does not: the databases rank above it.
 */
const settling = new Set<SegmentOrigin>(['manual', 'chapter', 'theintrodb', 'introdb', 'skipdb'])

/** Types the fingerprinting looks for (§12.3). */
const fingerprinted: readonly SegmentType[] = ['intro', 'credits']

const hasExternalId = (ref: SegmentItemRef) =>
  ref.tmdbId !== undefined || ref.imdbId !== undefined || ref.tvdbId !== undefined

/** A provider's segment kept only when it lies inside the file (end clamped to its duration). */
const withinFile = (
  candidate: SegmentCandidate,
  durationMs: number | undefined,
): SegmentCandidate | undefined => {
  const startMs = Math.max(0, candidate.startMs)
  const endMs = durationMs === undefined ? candidate.endMs : Math.min(candidate.endMs, durationMs)
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? { ...candidate, startMs, endMs }
    : undefined
}

/**
 * Job `fetch_segments` (§12.2, §18, by item): the resolution chain of a movie or an episode.
 * Manual segments stay and negative markers stop their type; then the file's chapters; then each
 * enabled provider in order, unless its cached answer is still fresh: the first one giving a type
 * wins it, the missing types go on. Every source asked leaves a `segment_lookups` row. A provider
 * failure (network, invalid answer) is recorded as `error` (retried in 7 days), a rate limit
 * (429, throttle) is not recorded (retried by the backfill), and the chain goes on: the job
 * itself does not fail. An episode still without `intro` or `credits` goes to
 * `fingerprint_season` (§12.3).
 */
export const fetchSegmentsFactory =
  ({ segmentTarget, segmentRepository, providers, settings, jobQueue, clock, logger }: Deps) =>
  async ({
    itemId,
    signal,
  }: {
    itemId: string
    signal?: AbortSignal
  }): Promise<Result<FetchSegmentsOutcome, never>> => {
    const target = segmentTarget(itemId)
    if (!target.ok) return ok('skipped')
    const { ref, timeline } = target.value
    if (!ref.detectSegments) return ok('disabled')
    const log = logger.child({ itemId })
    const config = settings.read()
    const now = clock.now()

    const lookups = segmentRepository.listLookups(itemId)
    const negative = new Set(lookups.flatMap((row) => negativeMarkerType(row.provider) ?? []))
    const stored = () => new Map(segmentRepository.listByItem(itemId).map((s) => [s.type, s]))
    const before = stored()
    const isManual = (type: SegmentType) => before.get(type)?.origin === 'manual'

    // §12.2 row 2: chapters rank above the databases, below a manual marker.
    const fromChapters = chapterSegments(timeline.chapters, timeline.durationMs).filter(
      (candidate) => !negative.has(candidate.type) && !isManual(candidate.type),
    )
    for (const candidate of fromChapters) {
      segmentRepository.save({ itemId, origin: 'chapter', candidate })
    }
    segmentRepository.saveLookup({
      itemId,
      provider: 'chapter',
      checkedAt: now,
      outcome: fromChapters.length > 0 ? 'found' : 'none',
    })

    const afterChapters = stored()
    const missing = new Set(
      segmentTypes.filter((type) => {
        if (negative.has(type)) return false
        const origin = afterChapters.get(type)?.origin
        return origin === undefined || !settling.has(origin)
      }),
    )

    // Without any id the databases cannot answer: nothing asked, nothing cached (asked once the
    // item is identified, §9.2). Nor for a file holding several episodes (§8.4 "E01-E02"): their
    // answers are on each episode's own timeline, which is not the file's past the first one, so
    // the credits of E02 would land minutes into the file. Chapters (file positions) still apply.
    const askable = hasExternalId(ref) && !target.value.sharesFile
    for (const providerId of config.providers) {
      if (missing.size === 0 || !askable || signal?.aborted === true) break
      const cached = lookups.find((row) => row.provider === providerId)
      if (cached !== undefined && isLookupFresh(cached, now)) continue
      const answer = await providers[providerId].lookup(ref, ref.durationMs, signal)
      const checkedAt = clock.now()
      if (!answer.ok) {
        // A rate limit says nothing about the item: left uncached, the backfill asks again
        // (`listItemsToResolve`); the provider is not asked again in this run.
        if (answer.error.code !== 'segment/provider_rate_limited') {
          segmentRepository.saveLookup({
            itemId,
            provider: providerId,
            checkedAt,
            outcome: 'error',
          })
        }
        log.warn('segment provider failed', { provider: providerId, code: answer.error.code })
        continue
      }
      const won: SegmentType[] = []
      for (const raw of answer.value.segments) {
        if (!missing.has(raw.type)) continue
        const candidate = withinFile(raw, ref.durationMs)
        if (candidate === undefined) continue
        if (segmentRepository.save({ itemId, origin: providerId, candidate }) === undefined)
          continue
        missing.delete(raw.type)
        won.push(raw.type)
      }
      // A type the provider states the work lacks stops nothing: the databases disagree (only
      // the admin's negative marker settles a type, §12.1); the next provider is asked.
      segmentRepository.saveLookup({
        itemId,
        provider: providerId,
        checkedAt,
        outcome: answer.value.segments.length > 0 ? 'found' : 'none',
      })
      log.debug('segment provider answered', { provider: providerId, won })
    }

    // §12.2 row 6: an episode still lacking intro or credits, without negative marker.
    const final = stored()
    const fingerprintLookup = lookups.find((row) => row.provider === 'fingerprint')
    const wantsFingerprint =
      ref.kind === 'episode' &&
      ref.seasonId !== undefined &&
      config.fingerprint.enabled &&
      (fingerprintLookup === undefined || !isLookupFresh(fingerprintLookup, now)) &&
      fingerprinted.some((type) => !negative.has(type) && !final.has(type))
    if (wantsFingerprint && ref.seasonId !== undefined) {
      jobQueue.enqueue({
        type: 'fingerprint_season',
        payload: { seasonId: ref.seasonId },
        dedupeKey: `fingerprint:${ref.seasonId}`,
      })
    }
    log.info('segments resolved', {
      types: [...final.keys()],
      missing: [...missing],
      fingerprint: wantsFingerprint,
    })
    return ok('resolved')
  }

export type FetchSegments = ReturnType<typeof fetchSegmentsFactory>
