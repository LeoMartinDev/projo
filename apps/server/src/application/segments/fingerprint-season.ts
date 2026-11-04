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

export const maxReferences = 6
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

export type FingerprintWindow = {
  path: string
  startSeconds: number
  durationSeconds: number
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
  targets: string[]
  window: FingerprintWindow
  order: number
}

export type FingerprintSeasonSummary = {
  episodes: number
  segments: number
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

    if (lastError !== undefined && read === 0) return err(lastError)

    const segments = saves.filter((save) => save()).length
    const checkedAt = clock.now()
    for (const [itemId, outcome] of outcomes)
      segmentRepository.saveLookup({ itemId, provider: 'fingerprint', checkedAt, outcome })
    logger.info('season fingerprinted', { seasonId, episodes: outcomes.size, segments })
    return ok({ episodes: outcomes.size, segments })
  }
