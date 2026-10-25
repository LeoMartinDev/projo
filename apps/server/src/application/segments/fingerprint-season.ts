import { appError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import {
  type AudioFingerprinter,
  detectSharedSegments,
  type EpisodeFingerprint,
  type FingerprintCatalog,
  type FingerprintEpisode,
  type FingerprintError,
  type FingerprintSettings,
  type FingerprintSettingsReader,
} from '../../core/segments/fingerprint.ts'
import {
  noSegmentKey,
  type SegmentLookupOutcome,
  type SegmentRepository,
} from '../../core/segments/segment.ts'

/**
 * §12.3 `fingerprint_season`: intro and credits of the episodes of a season that the chain left
 * without them, from the audio they share.
 *
 * - Waits for the chain (§12.3 "only for episodes without a result"): the first episode's
 *   `fetch_segments` enqueues this job while the others have not asked the providers yet. While a
 *   `fetch_segments` of an episode of the season is queued or running, the job does nothing and
 *   enqueues itself again `deferMs` (5 min) later.
 * - Targets: the episodes the catalog lists (the version playback plays, probed duration) whose
 *   chain has run (it always records its `chapter` lookup first), without a segment of the type
 *   and without its negative marker (`no_segment:<type>`). Only they receive segments and
 *   lookups; an episode whose chain has not run yet gets this job again from its own
 *   `fetch_segments`.
 * - References: episodes that already have the segment (any origin, e.g. a provider for E1–E5
 *   when E6 is missing) are fingerprinted too, only to corroborate the targets; their segment is
 *   never touched. At most `maxReferences` (6) of them, the closest to the targets in episode
 *   order, so that one missing episode in a 24-episode season costs 7 windows, not 24.
 *   Negatively marked episodes are neither.
 * - One file per version: episodes sharing a file (`E01-E02`, §8.4) are fingerprinted once, as
 *   one participant (a file never corroborates itself). Positions are on the file's timeline, so
 *   only its first episode can get the `intro` and only its last the `credits`; the others get
 *   neither segment nor lookup from it.
 * - Stacks (§7.7): the intro is searched in the first part, the credits in the last one, and the
 *   position is put back on the item timeline (durations of the previous parts added).
 * - Windows: the first `introMinutes` and the last `creditsMinutes`, each capped at half of a
 *   single-file episode so that a short episode's intro window never holds its credits.
 * - A type runs only with at least one target and two participants (targets + references,
 *   §12.3 "2 episodes minimum"); confidence = share of the other participants corroborating.
 * - Results: segments of origin `fingerprint` (the lowest priority, §12.1), and one `fingerprint`
 *   lookup per processed target: `found` (either type), else `error` when its audio could not be
 *   read, else `none`.
 * - Failures: `fpcalc` or `ffmpeg` missing, or no file readable at all, fail the job (retried,
 *   §18); a single unreadable file only costs that episode.
 */

/** References fingerprinted per type at most. */
export const maxReferences = 6
/** Delay before trying again while the chain still runs for the season. */
export const deferMs = 5 * 60_000

type Deps = {
  catalog: FingerprintCatalog
  segmentRepository: SegmentRepository
  fingerprinter: AudioFingerprinter
  settings: FingerprintSettingsReader
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}

type FingerprintType = 'intro' | 'credits'
const fingerprintTypes: FingerprintType[] = ['intro', 'credits']

/** A window of audio to fingerprint, and where it sits on the item timeline. */
export type FingerprintWindow = {
  path: string
  startSeconds: number
  durationSeconds: number
  /** Item timeline position of the start of the window. */
  itemOffsetMs: number
  itemDurationMs: number
}

export const fingerprintWindow = (
  { parts }: FingerprintEpisode,
  type: FingerprintType,
  settings: FingerprintSettings,
): FingerprintWindow | undefined => {
  const itemDurationMs = parts.reduce((total, part) => total + part.durationMs, 0)
  const part = type === 'intro' ? parts[0] : parts.at(-1)
  if (part === undefined) return undefined
  const partSeconds = part.durationMs / 1000
  const minutes = type === 'intro' ? settings.introMinutes : settings.creditsMinutes
  const length = Math.min(minutes * 60, parts.length === 1 ? partSeconds / 2 : partSeconds)
  if (!(length >= settings.minSeconds)) return undefined
  const startSeconds = type === 'intro' ? 0 : partSeconds - length
  const previousPartsMs = type === 'intro' ? 0 : itemDurationMs - part.durationMs
  return {
    path: part.path,
    startSeconds,
    durationSeconds: length,
    itemOffsetMs: previousPartsMs + startSeconds * 1000,
    itemDurationMs,
  }
}

type Participant = {
  fileKey: string
  /** Items of the file that receive the segment; empty for a reference. */
  targets: string[]
  window: FingerprintWindow
  /** Position of the file in episode order. */
  order: number
}

export type FingerprintSeasonSummary = {
  episodes: number
  segments: number
  /** The chain still runs for the season: enqueued again for later. */
  deferred?: true
}

const aborted = (): FingerprintError =>
  appError('segment/fingerprint_failed', 'fingerprinting aborted', {
    context: { reason: 'aborted' },
  })

export const fingerprintSeasonFactory =
  ({
    catalog,
    segmentRepository,
    fingerprinter,
    settings: reader,
    jobQueue,
    clock,
    logger,
  }: Deps) =>
  async ({
    seasonId,
    signal,
    reportProgress = () => {},
  }: {
    seasonId: string
    signal?: AbortSignal
    reportProgress?: (progress: number) => void
  }): Promise<Result<FingerprintSeasonSummary, FingerprintError>> => {
    const settings = reader.read()
    if (!settings.enabled) {
      logger.debug('fingerprinting disabled', { seasonId })
      return ok({ episodes: 0, segments: 0 })
    }

    if (catalog.isChainPending(seasonId)) {
      jobQueue.enqueue({
        type: 'fingerprint_season',
        payload: { seasonId },
        dedupeKey: `fingerprint:${seasonId}`,
        runAfter: new Date(clock.now().getTime() + deferMs),
      })
      logger.debug('fingerprinting deferred: segment chain still running', { seasonId })
      return ok({ episodes: 0, segments: 0, deferred: true })
    }

    const has = (itemId: string, type: FingerprintType): boolean =>
      segmentRepository.find({ itemId, type }) !== undefined
    const needs = (itemId: string, type: FingerprintType): boolean => {
      if (has(itemId, type)) return false
      const lookups = segmentRepository.listLookups(itemId)
      return (
        lookups.some((row) => row.provider === 'chapter') &&
        !lookups.some((row) => row.provider === noSegmentKey(type) && row.outcome === 'no_segment')
      )
    }

    const participantsOf = (type: FingerprintType): Participant[] => {
      const all = [...files.values()].flatMap((file, order): Participant[] => {
        const window = fingerprintWindow(file, type, settings)
        if (window === undefined) return []
        // A shared file's positions are on its own timeline: right for its first episode's
        // intro and its last episode's credits only (§8.4).
        const owner = type === 'intro' ? file.itemIds[0] : file.itemIds.at(-1)
        if (owner === undefined) return []
        const targets = needs(owner, type) ? [owner] : []
        const reference = targets.length === 0 && has(owner, type)
        return targets.length > 0 || reference
          ? [{ fileKey: file.fileKey, targets, window, order }]
          : []
      })
      const targets = all.filter(({ targets }) => targets.length > 0)
      if (targets.length === 0) return []
      const distance = ({ order }: Participant) =>
        Math.min(...targets.map((target) => Math.abs(target.order - order)))
      const references = all
        .filter(({ targets }) => targets.length === 0)
        .sort((a, b) => distance(a) - distance(b) || a.order - b.order)
        .slice(0, maxReferences)
      return [...targets, ...references].sort((a, b) => a.order - b.order)
    }

    const files = new Map<string, FingerprintEpisode & { itemIds: string[] }>()
    for (const episode of catalog.listSeasonEpisodes(seasonId)) {
      const file = files.get(episode.fileKey)
      if (file === undefined) files.set(episode.fileKey, { ...episode, itemIds: [episode.itemId] })
      else file.itemIds.push(episode.itemId)
    }

    const plans = fingerprintTypes
      .map((type) => ({ type, participants: participantsOf(type) }))
      .filter(({ participants }) => participants.length >= 2)
    if (plans.length === 0) {
      logger.debug('nothing to fingerprint', { seasonId })
      return ok({ episodes: 0, segments: 0 })
    }

    const total = plans.reduce((sum, { participants }) => sum + participants.length, 0)
    let done = 0
    let read = 0
    let lastError: FingerprintError | undefined
    const outcomes = new Map<string, SegmentLookupOutcome>()
    const saves: (() => boolean)[] = []

    for (const { type, participants } of plans) {
      const fingerprints: EpisodeFingerprint[] = []
      for (const { fileKey, targets: itemIds, window } of participants) {
        if (signal?.aborted === true) return err(aborted())
        const result = await fingerprinter.fingerprint({
          path: window.path,
          startSeconds: window.startSeconds,
          durationSeconds: window.durationSeconds,
          ...(signal === undefined ? {} : { signal }),
        })
        done++
        reportProgress((done / total) * 100)
        if (!result.ok) {
          if (result.error.context?.['reason'] === 'binary_missing') return result
          lastError = result.error
          logger.warn('episode audio not fingerprinted', {
            seasonId,
            itemIds,
            type,
            code: result.error.code,
            error: result.error,
          })
          for (const itemId of itemIds)
            if (outcomes.get(itemId) !== 'found') outcomes.set(itemId, 'error')
          continue
        }
        read++
        fingerprints.push({ key: fileKey, points: result.value })
      }

      // The others could not be read: nothing to compare with, no answer for this type.
      if (fingerprints.length < 2) continue
      const detected = detectSharedSegments(fingerprints, settings)
      for (const { fileKey, targets: itemIds, window } of participants) {
        if (!fingerprints.some(({ key }) => key === fileKey)) continue
        const found = detected.get(fileKey)
        for (const itemId of itemIds) {
          if (found === undefined) {
            if (!outcomes.has(itemId)) outcomes.set(itemId, 'none')
            continue
          }
          const startMs = Math.max(0, Math.round(window.itemOffsetMs + found.startSeconds * 1000))
          const endMs = Math.min(
            window.itemDurationMs,
            Math.round(window.itemOffsetMs + found.endSeconds * 1000),
          )
          if (endMs <= startMs) continue
          outcomes.set(itemId, 'found')
          saves.push(
            () =>
              segmentRepository.save({
                itemId,
                origin: 'fingerprint',
                candidate: { type, startMs, endMs, confidence: found.confidence },
              }) !== undefined,
          )
        }
      }
    }

    // Nothing readable at all: the environment, not the files (job retried with backoff).
    if (lastError !== undefined && read === 0) return err(lastError)

    const segments = saves.filter((save) => save()).length
    const checkedAt = clock.now()
    for (const [itemId, outcome] of outcomes)
      segmentRepository.saveLookup({ itemId, provider: 'fingerprint', checkedAt, outcome })
    logger.info('season fingerprinted', { seasonId, episodes: outcomes.size, segments })
    return ok({ episodes: outcomes.size, segments })
  }
