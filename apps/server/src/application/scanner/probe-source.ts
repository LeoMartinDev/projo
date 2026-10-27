import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { FileSystem } from '../../core/fs/file-system.ts'
import type { Logger } from '../../core/logger.ts'
import {
  embeddedSubtitlesOf,
  type MediaDecoder,
  type MediaError,
  type MediaProber,
  probeDefect,
  SAMPLE_SECONDS,
  sampleOffsets,
  signatureOf,
} from '../../core/media/probe.ts'
import { MIN_VIDEO_SIZE_BYTES } from '../../core/naming/index.ts'
import type { MatchRequester } from '../../core/metadata/ports.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import type {
  PendingReason,
  Source,
  SourcePatch,
  SourceRepository,
} from '../../core/source/source.ts'
import type { LinkSourceItems } from './link-source-items.ts'

/**
 * - `quarantine`: a pending source whose quiet period is over (§7.3 step 4);
 * - `verify`: full scan, a ready source whose signature is checked again (§7.4);
 * - `recheck`: admin, the whole check again whatever the state.
 */
export type ProbeMode = 'quarantine' | 'verify' | 'recheck'

export type ProbeOutcome =
  'ready' | 'unchanged' | 'changed' | 'skipped' | 'probe_failed' | 'decode_failed'

type Deps = {
  sourceRepository: SourceRepository
  fileSystem: FileSystem
  prober: MediaProber
  decoder: MediaDecoder
  linkSourceItems: LinkSourceItems
  /** §7.2: ready → matching (job `match_source`). */
  requestMatch: MatchRequester
  notifier: AdminNotifier
  eventBus: EventBus
  clock: Clock
  logger: Logger
}

/**
 * Failures that say nothing about the file, nothing written: retried (ffmpeg not installed, too
 * slow) or interrupted (cancel, clean stop: released by the runner, §18).
 */
export type ProbeSourceError = AppError<'media/binary_missing' | 'media/timeout' | 'job/cancelled'>

const isToolFailure = (
  error: MediaError,
): error is AppError<'media/binary_missing' | 'media/timeout'> =>
  error.code === 'media/binary_missing' || error.code === 'media/timeout'

/**
 * Job `probe_source` (§7.3 step 4–5): ffprobe (duration > 0, a video stream), then three 2 s
 * decodes at 10/50/90 %. Success: `ready`, probe and signature stored, embedded subtitles listed,
 * items linked, `source.ready` published. Failure: back to `pending` with the reason.
 */
export const probeSourceFactory = ({
  sourceRepository,
  fileSystem,
  prober,
  decoder,
  linkSourceItems,
  requestMatch,
  notifier,
  eventBus,
  clock,
  logger,
}: Deps) => {
  const toPending = (source: Source, reason: PendingReason, details: unknown): ProbeOutcome => {
    const now = clock.now()
    sourceRepository.patch(source.id, {
      state: 'pending',
      pendingReason: reason,
      ...(source.state === 'pending' ? {} : { pendingSince: now }),
    })
    logger.info('source kept in quarantine', {
      sourceId: source.id,
      libraryId: source.libraryId,
      pendingReason: reason,
      error: details,
    })
    return reason === 'decode_failed' ? 'decode_failed' : 'probe_failed'
  }

  const runnable = (source: Source, mode: ProbeMode): boolean => {
    switch (mode) {
      case 'quarantine':
        return source.state === 'pending' && source.pendingReason !== 'too_small'
      case 'verify':
        return source.state === 'ready'
      case 'recheck':
        return source.state === 'pending' || source.state === 'ready'
    }
  }

  return async ({
    sourceId,
    mode,
    signal,
  }: {
    sourceId: string
    mode: ProbeMode
    signal?: AbortSignal
  }): Promise<Result<ProbeOutcome, ProbeSourceError>> => {
    const source = sourceRepository.findById(sourceId)
    const path = sourceRepository.absolutePathOf(sourceId)
    if (source === undefined || path === undefined || !runnable(source, mode)) return ok('skipped')
    const withSignal = signal === undefined ? {} : { signal }
    // An abort reaches here as `media/ffmpeg_failed`: the signal tells it apart.
    const notTheFile = (error: MediaError): ProbeSourceError | undefined => {
      if (signal?.aborted === true)
        return appError('job/cancelled', 'probe interrupted', { context: { sourceId } })
      return isToolFailure(error) ? error : undefined
    }

    // Bytes must be the ones the quiet period vouched for.
    const before = await fileSystem.stat(path)
    if (!before.ok || before.value.kind !== 'file') return ok('skipped')
    const quarantine = (sizeBytes: number, mtimeMs: number): ProbeOutcome => {
      const now = clock.now()
      const patch: SourcePatch = {
        state: 'pending',
        pendingReason: sizeBytes < MIN_VIDEO_SIZE_BYTES ? 'too_small' : 'growing',
        sizeBytes,
        mtimeMs,
        unchangedSince: now,
        stableSince: undefined,
        ...(source.state === 'pending' ? {} : { pendingSince: now }),
      }
      sourceRepository.patch(source.id, patch)
      return 'changed'
    }
    if (before.value.sizeBytes !== source.sizeBytes || before.value.mtimeMs !== source.mtimeMs) {
      return ok(quarantine(before.value.sizeBytes, before.value.mtimeMs))
    }

    const probe = await prober.probe({ path, ...withSignal })
    if (!probe.ok) {
      const failure = notTheFile(probe.error)
      if (failure !== undefined) return err(failure)
      return ok(toPending(source, 'probe_failed', probe.error))
    }
    const defect = probeDefect(probe.value)
    if (defect !== undefined) return ok(toPending(source, 'probe_failed', { defect }))
    const signature = signatureOf(source.sizeBytes, probe.value)
    if (mode === 'verify' && signature === source.signature) return ok('unchanged')

    for (const startSeconds of sampleOffsets(probe.value.durationMs)) {
      const decoded = await decoder.decodeSample({
        path,
        startSeconds,
        durationSeconds: SAMPLE_SECONDS,
        ...withSignal,
      })
      if (!decoded.ok) {
        const failure = notTheFile(decoded.error)
        if (failure !== undefined) return err(failure)
        return ok(toPending(source, 'decode_failed', decoded.error))
      }
    }

    const after = await fileSystem.stat(path)
    if (!after.ok || after.value.kind !== 'file') return ok('skipped')
    if (after.value.sizeBytes !== source.sizeBytes || after.value.mtimeMs !== source.mtimeMs) {
      return ok(quarantine(after.value.sizeBytes, after.value.mtimeMs))
    }

    // A scan may have moved, quarantined or marked the source missing while ffmpeg ran.
    const fresh = sourceRepository.findById(source.id)
    if (
      fresh === undefined ||
      fresh.state !== source.state ||
      fresh.relativePath !== source.relativePath ||
      fresh.sizeBytes !== source.sizeBytes ||
      fresh.mtimeMs !== source.mtimeMs
    ) {
      return ok('skipped')
    }

    const now = clock.now()
    const becameReady = source.state !== 'ready'
    sourceRepository.patch(source.id, {
      state: 'ready',
      pendingReason: undefined,
      pendingSince: undefined,
      missingSince: undefined,
      stableSince: source.stableSince ?? now,
      ...(becameReady ? { readyAt: now } : {}),
      probe: probe.value,
      signature,
    })
    sourceRepository.replaceEmbeddedSubtitles(source.id, embeddedSubtitlesOf(probe.value))
    const readyAt = becameReady ? now : (source.readyAt ?? now)
    linkSourceItems({ ...source, readyAt })
    // An identified source keeps its items (§7.3: a replaced file takes its place back).
    if (source.matchState !== 'matched' && source.matchState !== 'manual') {
      requestMatch({ sourceId: source.id })
    }
    notifier.resolve({ kind: 'scan/source_stuck_pending', key: source.id })
    if (becameReady) {
      eventBus.publish('source.ready', { sourceId: source.id, libraryId: source.libraryId })
      logger.info('source ready', { sourceId: source.id, libraryId: source.libraryId })
    }
    return ok('ready')
  }
}

export type ProbeSource = ReturnType<typeof probeSourceFactory>
